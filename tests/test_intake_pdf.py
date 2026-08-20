import pytest

from src.intake import IntakeError, read_source
from tests._pdfbuild import LINKEDIN_EXPORT, minimal_pdf


def write(tmp_path, name, data):
    p = tmp_path / name
    p.write_bytes(data if isinstance(data, bytes) else data.encode())
    return str(p)


def test_reads_a_plain_text_file(tmp_path):
    path = write(tmp_path, "p.txt", "Led growth at an agency for six years.")
    text, removed = read_source(path)
    assert "Led growth" in text


def test_reads_a_pdf(tmp_path):
    path = write(tmp_path, "p.pdf", minimal_pdf(["Led growth at an agency."]))
    text, _ = read_source(path)
    assert "Led growth at an agency." in text


def test_detects_pdf_by_magic_bytes_not_extension(tmp_path):
    # A LinkedIn export saved without an extension must still work.
    path = write(tmp_path, "profile", minimal_pdf(["Led growth at an agency."]))
    text, _ = read_source(path)
    assert "Led growth at an agency." in text


def test_strips_linkedin_furniture_from_a_pdf(tmp_path):
    path = write(tmp_path, "p.pdf", minimal_pdf(LINKEDIN_EXPORT))
    text, removed = read_source(path)
    assert "most talented engineer" not in text
    assert "Page 1 of 2" not in text
    assert "the hard part" in text
    assert removed


def test_undecodable_non_pdf_gives_a_clean_error(tmp_path):
    # The bug that started this: a binary file used to raise an uncaught
    # UnicodeDecodeError traceback out of cli.main.
    path = write(tmp_path, "p.bin", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\xff\xfe")
    with pytest.raises(IntakeError):
        read_source(path)


def test_missing_file_raises_intake_error(tmp_path):
    with pytest.raises(IntakeError):
        read_source(str(tmp_path / "nope.txt"))


def test_unreadable_pdf_raises_intake_error(tmp_path):
    path = write(tmp_path, "p.pdf", b"%PDF-1.4\nnot really a pdf\n%%EOF\n")
    with pytest.raises(IntakeError):
        read_source(path)
