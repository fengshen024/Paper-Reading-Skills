"""Behavior tests for text provenance, crop geometry and output preservation."""
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from PIL import Image


SCRIPT = Path(__file__).with_name('extract-paper.py')


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


if __name__ == '__main__':
    unittest.main()
