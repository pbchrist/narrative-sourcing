"""Reading text out of a PDF.

Detection is by magic bytes rather than file extension: a LinkedIn export
saved without an extension, or named .txt by a browser, should still
work, and a PNG named .pdf should fail honestly.
"""

PDF_MAGIC = b"%PDF"


class PdfError(ValueError):
    """The file could not be read as a PDF."""


def looks_like_pdf(data: bytes) -> bool:
    return data[:1024].lstrip()[:4] == PDF_MAGIC


def extract_text(data: bytes) -> str:
    try:
        import io

        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise PdfError(f"pypdf is required to read PDFs: {exc}") from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as exc:
        raise PdfError(f"could not read PDF: {exc}") from exc

    text = "\n".join(pages).strip()
    if not text:
        raise PdfError(
            "no text found in PDF. If this is a scanned or image-only "
            "export, re-export it as text rather than running OCR: a "
            "mis-OCR'd quote would fail evidence verification for the "
            "wrong reason."
        )
    return text


__all__ = ["PdfError", "extract_text", "looks_like_pdf"]
