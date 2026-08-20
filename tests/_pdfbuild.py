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
