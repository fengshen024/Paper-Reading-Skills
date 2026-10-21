"""Extract searchable PDF text and render selected pages/crops for visual checking.

Original helper for this skill; the workflow follows 02-paper-reader's
extract -> inspect -> refine approach. It does not automatically detect figures.
Crop coordinates are PDF points measured from the page's top-left corner.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re


def parse_pages(spec: str, count: int) -> list[int]:
    pages: set[int] = set()
    for part in spec.split(','):
        bounds = part.strip().split('-')
        if len(bounds) == 1:
            first = last = int(bounds[0])
        elif len(bounds) == 2:
            first, last = map(int, bounds)
        else:
            raise ValueError(f'Invalid page selection: {part}')
        if not 1 <= first <= last <= count:
            raise ValueError(f'Page selection must stay within 1-{count}: {part}')
        pages.update(range(first, last + 1))
    return sorted(pages)


def render_jobs(args: argparse.Namespace, count: int) -> list[dict]:
    selected = parse_pages(args.pages, count) if args.pages else []
    if args.clip and len(selected) != 1:
        raise ValueError('--clip requires exactly one selected page.')
    jobs = [dict(page=n, clip=args.clip, file=f'page-{n:03d}{"-clip" if args.clip else ""}.png') for n in selected]
    if args.clips:
        entries = json.loads(Path(args.clips).read_text(encoding='utf-8-sig'))
        if not isinstance(entries, list) or not entries:
            raise ValueError('--clips must contain a nonempty JSON array.')
        for index, entry in enumerate(entries, 1):
            if not isinstance(entry, dict):
                raise ValueError('Each crop must be an object with page, box, and optional name.')
            n, box, name = entry.get('page'), entry.get('box'), entry.get('name', str(index))
            if type(n) is not int or not 1 <= n <= count:
                raise ValueError(f'Crop page must be within 1-{count}.')
            if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', name):
                raise ValueError('Crop name must use 1-64 ASCII letters, digits, underscores or hyphens.')
            if not isinstance(box, list) or len(box) != 4 or any(type(v) not in (int, float) or not math.isfinite(v) for v in box):
                raise ValueError('Crop box must contain four finite numbers in top-left PDF points.')
            jobs.append(dict(page=n, clip=box, file=f'page-{n:03d}-clip-{name}.png'))
    if len({job['file'] for job in jobs}) != len(jobs):
        raise ValueError('Duplicate crop output names; give crops on the same page distinct names.')
    return jobs


def extract(args: argparse.Namespace) -> None:
    if not 0 < args.scale <= 4:
        raise ValueError('--scale must be greater than 0 and at most 4.')
    if args.no_text and not (args.pages or args.clips):
        raise ValueError('--no-text requires --pages or --clips.')
    source, output = Path(args.pdf).resolve(), Path(args.output).resolve()
    source_stat = source.stat()
    manifest, text_file = output / 'source.json', output / 'paper-text.txt'
    previous = {}
    if args.append and manifest.exists():
        previous = json.loads(manifest.read_text(encoding='utf-8'))
        if not isinstance(previous, dict) or Path(previous.get('source_pdf', '')).resolve() != source:
            raise ValueError('--append requires a source.json for the same PDF.')
        for key, value in [('source_size', source_stat.st_size), ('source_mtime_ns', source_stat.st_mtime_ns)]:
            if key in previous and previous[key] != value:
                raise ValueError('Source PDF changed; use a new output directory.')
        old_pages = previous.get('rendered_pages')
        if not isinstance(old_pages, list) or any(type(n) is not int for n in old_pages):
            raise ValueError('Invalid rendered_pages in source.json.')
        records = previous.get('renders', [])
        if (not isinstance(records, list) or any(not isinstance(r, dict) or not isinstance(r.get('file'), str) for r in records)
                or not isinstance(previous.get('page_sizes_points', {}), dict)):
            raise ValueError('Invalid render records in source.json.')
    elif args.append and text_file.exists():
        raise ValueError('--append cannot reuse existing text without source.json.')

    # Appending preserves existing text; --force can explicitly refresh it.
    write_text = not args.no_text and (not args.append or not text_file.exists() or args.force)
    document = None
    try:
        reader = None
        if write_text:
            from pypdf import PdfReader
            reader = PdfReader(source)
            if reader.is_encrypted:
                raise ValueError('Encrypted PDF: provide an unlocked copy.')
            count = len(reader.pages)
        if args.pages or args.clips:
            import pypdfium2 as pdfium
            document = pdfium.PdfDocument(str(source))
            count = len(document)
        elif reader is None:
            count = previous.get('page_count', 0)
        if not count or (previous and previous.get('page_count') != count):
            raise ValueError('Invalid or changed PDF page count.')
        if any(not 1 <= n <= count for n in previous.get('rendered_pages', [])):
            raise ValueError('Invalid rendered_pages in source.json.')
        jobs = render_jobs(args, count)
        targets = [output / job['file'] for job in jobs]
        if not args.append:
            targets.append(manifest)
        if write_text:
            targets.append(text_file)
        if not args.force and any(p.exists() for p in targets):
            raise FileExistsError('Refusing to overwrite; use --append for new crops or --force for intentional replacement.')

        # Validate the ENTIRE batch before text extraction or any output writes.
        sizes = dict(previous.get('page_sizes_points', {}))
        for n in sorted({job['page'] for job in jobs}):
            page = document[n - 1]
            try:
                sizes[str(n)] = list(page.get_size())
            finally:
                page.close()
        for job in jobs:
            if job['clip']:
                width, height = sizes[str(job['page'])]
                x0, y0, x1, y1 = job['clip']
                if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
                    raise ValueError(f'Crop on page {job["page"]} must be inside {width} x {height} pt.')
                if round(x1 * args.scale) <= round(x0 * args.scale) or round(y1 * args.scale) <= round(y0 * args.scale):
                    raise ValueError('Crop is smaller than one pixel at this scale.')

        texts = [page.extract_text() or '' for page in reader.pages] if write_text else None
        metadata = dict(previous)
        metadata.update({
            'source_pdf': str(source), 'source_size': source_stat.st_size,
            'source_mtime_ns': source_stat.st_mtime_ns, 'page_count': count,
            'rendered_pages': sorted(set(previous.get('rendered_pages', [])) | {j['page'] for j in jobs}),
            'page_sizes_points': sizes, 'crop_top_left_points': args.clip,
            'scale_pixels_per_point': args.scale,
            'warning': 'Text extraction can reorder columns and lose equations; verify against page images. Empty text may require OCR.',
        })
        if texts is not None:
            metadata['characters_by_page'] = [len(t.strip()) for t in texts]
        # Each record has its own box/scale; top-level fields describe the last run only.
        replacements = {job['file'] for job in jobs}
        metadata['renders'] = [r for r in previous.get('renders', []) if r.get('file') not in replacements]
        metadata['renders'] += [dict(job, scale=args.scale) for job in jobs]
        output.mkdir(parents=True, exist_ok=True)
        if texts is not None:
            text_file.write_text('\n\n'.join(f'=== PDF page {n} ===\n{t}' for n, t in enumerate(texts, 1)), encoding='utf-8')
        # Render a page once even when several crops share it.
        for n in sorted({job['page'] for job in jobs}):
            page = document[n - 1]
            bitmap = image = None
            try:
                bitmap = page.render(scale=args.scale)
                image = bitmap.to_pil()
                for job in (job for job in jobs if job['page'] == n):
                    target = output / job['file']
                    if job['clip']:
                        cropped = image.crop(tuple(round(v * args.scale) for v in job['clip']))
                        try:
                            cropped.save(target)
                        finally:
                            cropped.close()
                    else:
                        image.save(target)
            finally:
                if image is not None:
                    image.close()
                if bitmap is not None:
                    bitmap.close()
                page.close()
        manifest.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        if document is not None:
            document.close()
    text_status = f'Extracted {count} pages of text' if write_text else 'Skipped text extraction'
    print(f'{text_status}; rendered {len(jobs)} image(s) to {output}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf')
    parser.add_argument('output')
    parser.add_argument('--pages', help='1-based page selection, e.g. 1,3-5. Without it, extract text only.')
    parser.add_argument('--clip', type=float, nargs=4, metavar=('X0', 'Y0', 'X1', 'Y1'))
    parser.add_argument('--clips', help='Batch JSON array: [{"page": 3, "box": [50,80,560,400], "name": "fig2"}].')
    parser.add_argument('--append', action='store_true', help='Add outputs for the same PDF; preserve existing text and merge render records.')
    parser.add_argument('--no-text', action='store_true', help='Render only; do not import the text extractor or extract full PDF text.')
    parser.add_argument('--scale', type=float, default=2)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if args.clip and args.clips:
        parser.error('--clip and --clips cannot be combined.')
    try:
        extract(args)
    except (ImportError, ValueError, FileNotFoundError, FileExistsError) as exc:
        parser.exit(2, f'{exc}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
