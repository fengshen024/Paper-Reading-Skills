"""Behavior tests for text provenance, crop geometry and output preservation."""
from pathlib import Path
import argparse
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from PIL import Image


SCRIPT = Path(__file__).with_name('extract-paper.py')
SPEC = importlib.util.spec_from_file_location('extract_paper', SCRIPT)
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)


class PdfToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='personal-paper-pdf-test-')
        self.root = Path(self.temp.name).resolve()
        self.pdf = self.root / 'source.pdf'
        writer = PdfWriter()
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        for number in (1, 2):
            page = writer.add_blank_page(width=300, height=400)
            page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
            stream = DecodedStreamObject()
            stream.set_data(f'0 g 50 340 40 30 re f BT /F1 14 Tf 40 300 Td (Synthetic source page {number}) Tj ET'.encode('ascii'))
            page[NameObject('/Contents')] = writer._add_object(stream)
        with self.pdf.open('wb') as handle:
            writer.write(handle)

    def tearDown(self):
        self.assertEqual(self.root.parent, Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith('personal-paper-pdf-test-'))
        self.temp.cleanup()

    def run_tool(self, output, *args):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.pdf), str(output), *args], text=True, capture_output=True, encoding='utf-8')

    def test_extracts_all_text_and_renders_only_selected_page(self):
        output = self.root / 'result'
        result = self.run_tool(output, '--pages', '2', '--scale', '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        text = (output / 'paper-text.txt').read_text(encoding='utf-8')
        self.assertIn('Synthetic source page 1', text)
        self.assertIn('Synthetic source page 2', text)
        meta = json.loads((output / 'source.json').read_text(encoding='utf-8'))
        self.assertEqual(meta['page_count'], 2)
        self.assertEqual(meta['rendered_pages'], [2])
        self.assertFalse((output / 'page-001.png').exists())
        with Image.open(output / 'page-002.png') as image:
            self.assertEqual(image.size, (300, 400))
            self.assertLess(image.convert('L').getextrema()[0], 100)

    def test_crop_uses_top_left_points_at_requested_scale(self):
        output = self.root / 'crop'
        result = self.run_tool(output, '--pages', '1', '--clip', '20', '40', '120', '100', '--scale', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        with Image.open(output / 'page-001-clip.png') as image:
            self.assertEqual(image.size, (200, 120))
            self.assertLess(image.convert('L').getextrema()[0], 100, 'Top-left crop includes the upper black rectangle; a bottom-left crop would be blank.')

    def test_invalid_range_and_crop_write_no_output(self):
        for name, args in [('range', ['--pages', '3']), ('crop', ['--pages', '1', '--clip', '0', '0', '400', '500'])]:
            with self.subTest(name=name):
                output = self.root / name
                self.assertNotEqual(self.run_tool(output, *args).returncode, 0)
                self.assertFalse(output.exists())

    def test_existing_outputs_are_preserved_without_force(self):
        output = self.root / 'existing'
        self.assertEqual(self.run_tool(output).returncode, 0)
        target = output / 'paper-text.txt'
        target.write_text('User edited text', encoding='utf-8')
        self.assertNotEqual(self.run_tool(output).returncode, 0)
        self.assertEqual(target.read_text(encoding='utf-8'), 'User edited text')

    def test_append_preserves_text_and_accumulates_pages_and_named_crops(self):
        output = self.root / 'append'
        self.assertEqual(self.run_tool(output, '--pages', '1').returncode, 0)
        text_file = output / 'paper-text.txt'
        text_file.write_text('User edited text', encoding='utf-8')
        before = text_file.stat().st_mtime_ns
        crops = self.root / 'crops.json'
        crops.write_text(json.dumps([
            {'page': 1, 'box': [20, 40, 120, 100], 'name': 'fig1'},
            {'page': 1, 'box': [150, 200, 250, 300], 'name': 'fig2'},
        ]), encoding='utf-8')
        result = self.run_tool(output, '--append', '--no-text', '--pages', '2', '--clips', str(crops), '--scale', '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(text_file.read_text(encoding='utf-8'), 'User edited text')
        self.assertEqual(text_file.stat().st_mtime_ns, before)
        meta = json.loads((output / 'source.json').read_text(encoding='utf-8'))
        self.assertEqual(meta['rendered_pages'], [1, 2])
        self.assertEqual(len(meta['renders']), 4)
        self.assertEqual(meta['page_sizes_points']['1'], [300, 400])
        with Image.open(output / 'page-001-clip-fig1.png') as image:
            self.assertEqual(image.size, (100, 60))
            self.assertLess(image.convert('L').getextrema()[0], 100)
        with Image.open(output / 'page-001-clip-fig2.png') as image:
            self.assertEqual(image.convert('L').getextrema(), (255, 255))
        self.assertNotEqual(self.run_tool(output, '--append', '--no-text', '--clips', str(crops)).returncode, 0)
        result = self.run_tool(output, '--append', '--no-text', '--force', '--clips', str(crops), '--scale', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        meta = json.loads((output / 'source.json').read_text(encoding='utf-8'))
        self.assertEqual(len(meta['renders']), 4, 'Replacement updates records rather than duplicating them.')
        with Image.open(output / 'page-001-clip-fig1.png') as image:
            self.assertEqual(image.size, (200, 120))
        self.assertEqual(len(list(output.glob('*.txt'))), 1)
        # --append alone also avoids re-extraction when text already exists.
        self.assertEqual(self.run_tool(output, '--append', '--pages', '2', '--clip', '0', '0', '100', '100').returncode, 0)
        self.assertEqual(text_file.read_text(encoding='utf-8'), 'User edited text')

    def test_render_only_does_not_import_pypdf_and_renders_shared_page_once(self):
        import pypdfium2 as pdfium
        crops = self.root / 'batch.json'
        crops.write_text(json.dumps([
            {'page': 1, 'box': [20, 40, 120, 100], 'name': 'one'},
            {'page': 1, 'box': [150, 200, 250, 300], 'name': 'two'},
        ]), encoding='utf-8')
        output = self.root / 'render-only'
        args = argparse.Namespace(pdf=str(self.pdf), output=str(output), pages=None, clip=None,
                                  clips=str(crops), scale=2, append=False, no_text=True, force=False)
        original_render = pdfium.PdfPage.render
        with patch.dict(sys.modules, {'pypdf': None}), patch.object(pdfium.PdfPage, 'render', autospec=True, side_effect=original_render) as render, contextlib.redirect_stdout(io.StringIO()):
            TOOL.extract(args)
        self.assertEqual(render.call_count, 1)
        self.assertFalse((output / 'paper-text.txt').exists())
        self.assertEqual(len(list(output.glob('*.png'))), 2)

    def test_invalid_batch_writes_nothing_even_when_first_crop_is_valid(self):
        for label, bad in [
            ('outside', {'page': 2, 'box': [0, 0, 301, 100], 'name': 'bad'}),
            ('traversal', {'page': 1, 'box': [0, 0, 100, 100], 'name': '../bad'}),
            ('duplicate', {'page': 1, 'box': [0, 0, 100, 100], 'name': 'good'}),
            ('tiny', {'page': 1, 'box': [0, 0, 0.01, 0.01], 'name': 'tiny'}),
        ]:
            with self.subTest(label=label):
                crops = self.root / (label + '.json')
                crops.write_text(json.dumps([{'page': 1, 'box': [0, 0, 100, 100], 'name': 'good'}, bad]), encoding='utf-8')
                output = self.root / label
                self.assertNotEqual(self.run_tool(output, '--clips', str(crops)).returncode, 0)
                self.assertFalse(output.exists())

    def test_append_rejects_different_or_modified_source_before_writing(self):
        output = self.root / 'source-check'
        self.assertEqual(self.run_tool(output, '--pages', '1').returncode, 0)
        manifest = output / 'source.json'
        before = manifest.read_bytes()
        meta = json.loads(before)
        meta['source_pdf'] = str(self.root / 'other.pdf')
        manifest.write_text(json.dumps(meta), encoding='utf-8')
        self.assertNotEqual(self.run_tool(output, '--append', '--no-text', '--pages', '2').returncode, 0)
        self.assertFalse((output / 'page-002.png').exists())
        manifest.write_bytes(before)
        self.pdf.write_bytes(self.pdf.read_bytes() + b'\n% modified\n')
        self.assertNotEqual(self.run_tool(output, '--append', '--no-text', '--pages', '2').returncode, 0)
        self.assertEqual(manifest.read_bytes(), before)

    def test_legacy_manifest_can_be_extended_without_reextracting(self):
        output = self.root / 'legacy'
        output.mkdir()
        (output / 'source.json').write_text(json.dumps({'source_pdf': str(self.pdf), 'page_count': 2, 'rendered_pages': [1]}), encoding='utf-8')
        (output / 'paper-text.txt').write_text('old text', encoding='utf-8')
        result = self.run_tool(output, '--append', '--no-text', '--pages', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((output / 'source.json').read_text(encoding='utf-8'))['rendered_pages'], [1, 2])


if __name__ == '__main__':
    unittest.main()
