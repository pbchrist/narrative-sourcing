"""Builds minimal one-page PDFs so the PDF path is genuinely tested
without adding a PDF-writing library as a dependency."""


def minimal_pdf(lines: list[str]) -> bytes:
    text = "BT /F1 11 Tf 14 TL 40 750 Td\n"
    for ln in lines:
        esc = ln.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        text += f"({esc}) Tj T*\n"
    text += "ET"
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        b"/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
        b"<</Length " + str(len(text)).encode() + b">>stream\n"
        + text.encode() + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj" + o + b"endobj\n"
    xref = len(out)
    out += b"xref\n0 " + str(len(objs) + 1).encode() + b"\n0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += (b"trailer<</Size " + str(len(objs) + 1).encode()
            + b"/Root 1 0 R>>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n")
    return bytes(out)


LINKEDIN_EXPORT = [
    "Contact", "riley@example.com", "+1 555 010 9931",
    "www.linkedin.com/in/rileychen (LinkedIn)",
    "Top Skills", "Distributed Systems", "PostgreSQL", "Incident Response",
    "Languages", "English (Native)",
    "Riley Chen", "Staff Engineer", "Portland, Oregon",
    "Summary",
    "I like problems where the hard part isn't the code. I have spent",
    "most of my career on the unglamorous half of software.",
    "Experience",
    "Kepler Health", "Staff Engineer", "2019 - 2022",
    "Owned the patient-scheduling rewrite end to end, including",
    "migration, on-call and the edge cases after launch.",
    "Thornbury Digital", "Senior Engineer", "2015 - 2019",
    "Got very good at estimating work I would never have to maintain.",
    "Education", "Reed College", "BA Mathematics",
    "Recommendations",
    "Riley is the most talented engineer I have ever worked with and",
    "transformed our entire platform single-handedly.",
    "Page 1 of 2",
]


# --- the shapes that broke the browser reader --------------------------------
# The reader in docs/app.js has no PDF library behind it, so the exact byte
# layout of a stream is part of its contract. These build the layouts that
# defeated it, small enough to read in one sitting.

def _assemble(objs: list[bytes]) -> bytes:
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 " + str(len(objs) + 1).encode() + b"\n0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += (b"trailer<</Size " + str(len(objs) + 1).encode()
            + b"/Root 1 0 R>>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n")
    return bytes(out)


def _page(font: bytes, contents_ref: bytes) -> list[bytes]:
    return [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        b"/Resources<</Font<</F1 5 0 R>>>>/Contents " + contents_ref + b">>",
    ]


def flate_indirect_length_pdf(lines: list[str]) -> bytes:
    """Apache FOP's layout: a compressed stream whose /Length is an indirect
    reference, and whose last compressed byte is a tab.

    Both halves matter. Misreading the reference costs nothing on its own,
    because the reader falls back to scanning for "endstream" - but the scan
    ate every trailing whitespace byte, and 0x09 here is data, not padding.
    One byte short is a stream that will not inflate at all.
    """
    import zlib

    for pad in range(4000):
        text = "BT /F1 11 Tf 14 TL 40 750 Td\n"
        for ln in lines:
            text += "(%s) Tj T*\n" % ln.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        text += "ET\n" + "%" + "x" * pad + "\n"
        blob = zlib.compress(text.encode(), 9)
        if blob[-1] == 0x09:
            break
    else:  # pragma: no cover - 4000 lengths without one is not credible
        raise AssertionError("no padding produced a stream ending in 0x09")

    objs = _page(b"", b"4 0 R")
    objs += [
        b"<</Length 6 0 R/Filter/FlateDecode>>\nstream\n" + blob + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        str(len(blob)).encode(),
    ]
    return _assemble(objs)


def subset_pdf(text: str, tounicode: bool) -> bytes:
    """A font subset: the page draws glyph numbers starting at 0x21, and only
    the ToUnicode table says which letters those are. Without it the reader can
    still produce a character for every glyph - they are simply the wrong
    characters, and that is the failure worth refusing.
    """
    order: list[str] = []
    for ch in text:
        if ch not in order:
            order.append(ch)
    codes = {ch: 0x21 + i for i, ch in enumerate(order)}
    drawn = "".join(chr(codes[ch]) for ch in text)
    esc = drawn.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    body = ("BT /F1 11 Tf 40 750 Td\n(%s) Tj\nET" % esc).encode("latin-1")

    font = (b"<</Type/Font/Subtype/TrueType/BaseFont/AAAAAA+Helvetica"
            b"/FirstChar 33/LastChar " + str(0x20 + len(order)).encode())
    if tounicode:
        font += b"/ToUnicode 6 0 R"
    font += b">>"

    objs = _page(b"", b"4 0 R")
    objs += [b"<</Length " + str(len(body)).encode() + b">>\nstream\n" + body + b"\nendstream", font]
    if tounicode:
        pairs = "".join("<%02X> <%04X>\n" % (codes[ch], ord(ch)) for ch in order)
        cmap = ("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
                "%d beginbfchar\n%sendbfchar\nendcmap\nend\nend\n" % (len(order), pairs)).encode()
        objs.append(b"<</Length " + str(len(cmap)).encode() + b">>\nstream\n" + cmap + b"\nendstream")
    return _assemble(objs)
