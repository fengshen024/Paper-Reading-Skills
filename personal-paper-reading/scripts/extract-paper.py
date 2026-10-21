"""Extract searchable PDF text and render selected pages/crops for visual checking.

Original helper for this skill; the workflow follows 02-paper-reader's
extract -> inspect -> refine approach. It does not automatically detect figures.
Crop coordinates are PDF points measured from the page's top-left corner.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


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


def extract(args: argparse.Namespace) -> None:
    from pypdf import PdfReader

    source = Path(args.pdf).resolve()
    output = Path(args.output).resolve()
    reader = PdfReader(source)
    if reader.is_encrypted:
        raise ValueError('Encrypted PDF: provide an unlocked copy.')
    count = len(reader.pages)
    selected = parse_pages(args.pages, count) if args.pages else []
    if args.clip and len(selected) != 1:
        raise ValueError('--clip requires exactly one selected page.')
    if not 0 < args.scale <= 4:
        raise ValueError('--scale must be greater than 0 and at most 4.')

    targets = [output / 'paper-text.txt', output / 'source.json']
    targets += [output / f'page-{n:03d}{"-clip" if args.clip else ""}.png' for n in selected]
    if not args.force:
        existing = [str(p) for p in targets if p.exists()]
        if existing:
            raise FileExistsError('Refusing to overwrite; use --force if intended: ' + ', '.join(existing))

    # Validate render dependencies and crop geometry before writing any output.
    document = None
    try:
        if selected:
            import pypdfium2 as pdfium
            document = pdfium.PdfDocument(str(source))
            if args.clip:
                page = document[selected[0] - 1]
                try:
                    width, height = page.get_size()
                finally:
                    page.close()
                x0, y0, x1, y1 = args.clip
                if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
                    raise ValueError(f'Crop must be inside the page ({width} x {height} pt).')

        texts = [page.extract_text() or '' for page in reader.pages]
        metadata = {
            'source_pdf': str(source), 'page_count': count,
            'characters_by_page': [len(t.strip()) for t in texts],
            'rendered_pages': selected, 'crop_top_left_points': args.clip,
            'scale_pixels_per_point': args.scale,
            'warning': 'Text extraction can reorder columns and lose equations; verify against page images. Empty text may require OCR.',
        }
        output.mkdir(parents=True, exist_ok=True)
        targets[0].write_text('\n\n'.join(f'=== PDF page {n} ===\n{t}' for n, t in enumerate(texts, 1)), encoding='utf-8')
        targets[1].write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
        for n, target in zip(selected, targets[2:]):
            page = document[n - 1]
            bitmap = None
            image = None
            try:
                bitmap = page.render(scale=args.scale)
                image = bitmap.to_pil()
                if args.clip:
                    box = tuple(round(v * args.scale) for v in args.clip)
                    cropped = image.crop(box)
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
    finally:
        if document is not None:
            document.close()
    print(f'Extracted {count} pages of text; rendered {len(selected)} page image(s) to {output}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf')
    parser.add_argument('output')
    parser.add_argument('--pages', help='1-based page selection, e.g. 1,3-5. Without it, extract text only.')
    parser.add_argument('--clip', type=float, nargs=4, metavar=('X0', 'Y0', 'X1', 'Y1'))
    parser.add_argument('--scale', type=float, default=2)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    try:
        extract(args)
    except (ImportError, ValueError, FileNotFoundError, FileExistsError) as exc:
        parser.exit(2, f'{exc}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
