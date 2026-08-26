"""The reader that actually runs in the browser.

docs/app.js parses PDFs with no library behind it, and until now nothing
exercised it: the indirect-/Length fix landed, was lost to an edit, landed
again - and a LinkedIn export still came out as glyph numbers, because a
different line was quietly truncating the stream by one byte. These run the
shipped file through node, the same way bench/parity.js does for the gates.
"""

import shutil
import subprocess

import pytest

from tests._pdfbuild import LINKEDIN_EXPORT, flate_indirect_length_pdf, minimal_pdf, subset_pdf

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def read(tmp_path, data: bytes):
    p = tmp_path / "p.pdf"
    p.write_bytes(data)
    out = subprocess.run(
        ["node", "bench/pdfread.js", str(p)],
        capture_output=True, text=True, timeout=60, check=True,
    ).stdout
    verdict, _, body = out.partition("\n")
    return verdict, body


def test_reads_a_plain_pdf(tmp_path):
    verdict, text = read(tmp_path, minimal_pdf(LINKEDIN_EXPORT))
    assert verdict == "OK"
    assert "Led growth" not in text          # nothing invented
    assert "Kepler Health" in text


def test_reads_a_compressed_stream_with_an_indirect_length(tmp_path):
    # The live failure, in miniature. /Length is a reference to another object,
    # and the last byte of the compressed data is a tab: scanning for
    # "endstream" and eating the whitespace in front of it loses that byte, and
    # a stream one byte short does not inflate at all.
    verdict, text = read(tmp_path, flate_indirect_length_pdf(LINKEDIN_EXPORT))
    assert verdict == "OK"
    assert "the hard part isn't the code" in text
    assert "Kepler Health" in text


def test_reads_a_font_subset_through_its_tounicode_table(tmp_path):
    # A résumé printed from Word or Pages draws glyph numbers, not letters.
    body = ("Led growth at an agency for six years and then left to build "
            "tools instead of using them.")
    verdict, text = read(tmp_path, subset_pdf(body, tounicode=True))
    assert verdict == "OK"
    assert body in text


def test_refuses_a_subset_with_no_way_back_to_letters(tmp_path):
    # The same page without the table. Every character still decodes to
    # something, which is the danger: left alone it would hand 19,000
    # characters of glyph numbers to the verifier, which would dutifully
    # confirm quotes against gibberish and report that nothing was deleted.
    body = ("Led growth at an agency for six years and then left to build "
            "tools instead of using them.")
    verdict, text = read(tmp_path, subset_pdf(body, tounicode=False))
    assert verdict == "REFUSED"
    assert "not words" in text
    assert ".docx" in text


def test_refuses_a_password_protected_pdf_for_the_right_reason(tmp_path):
    # It already refused, but told the reader to run OCR - advice that cannot
    # work on a file whose text is encrypted rather than absent. Refusing is
    # only useful if it says which problem this is.
    pytest.importorskip("pypdf")
    import io

    from pypdf import PdfWriter

    w = PdfWriter(clone_from=io.BytesIO(minimal_pdf(LINKEDIN_EXPORT)))
    w.encrypt("hunter2")
    buf = io.BytesIO()
    w.write(buf)

    verdict, text = read(tmp_path, buf.getvalue())
    assert verdict == "REFUSED"
    assert "password" in text
    assert "OCR" not in text
