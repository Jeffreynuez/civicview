"""Uploaded post images keep no hidden metadata (2026-10-16).

Run:  cd backend && python3 tests/test_image_metadata_strip.py   (exit 0 = pass)

Before: /api/pages/images/upload stored the file exactly as uploaded,
so a phone photo kept its EXIF, including the GPS location where it was
taken, and anyone viewing the post could download it.

Now every upload is re-encoded from its pixels (services/image_storage
.strip_image_metadata): no EXIF, GPS, XMP, comments, PNG text chunks or
color profile survive. The EXIF orientation is applied first so the
photo stays upright, and the format stays the same.
"""
import io
import os
import sys
import tempfile
from pathlib import Path


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"):
        os.environ.pop(name, None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    from PIL import ExifTags, Image, ImageCms, PngImagePlugin

    import app.services.image_storage as storage
    from app.services.image_storage import ImageRejected, strip_image_metadata

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    def gps_exif(orientation=1):
        e = Image.Exif()
        e[0x0112] = orientation
        e[0x010F] = "PhoneMakerCo"
        e[ExifTags.IFD.GPSInfo] = {1: "N", 2: (28.0, 32.0, 10.5), 3: "W", 4: (81.0, 22.0, 48.0)}
        return e

    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    secrets = (b"PhoneMakerCo", b"secret note", b"xmpmeta")

    def no_hidden_details(label, raw):
        im = Image.open(io.BytesIO(raw))
        check(len(im.getexif()) == 0, f"{label}: EXIF left: {dict(im.getexif())}")
        check(not im.getexif().get_ifd(ExifTags.IFD.GPSInfo), f"{label}: GPS left")
        for key in ("exif", "xmp", "icc_profile", "comment", "XML:com.adobe.xmp", "Comment"):
            check(key not in im.info, f"{label}: {key} left in the file")
        for s in secrets:
            check(s not in raw, f"{label}: {s!r} still in the bytes")
        return im

    # 1. A JPEG with GPS, a camera maker, a comment, XMP, a color profile
    #    and orientation 6 (stored sideways, shown rotated 90 degrees
    #    clockwise). Red block in the stored image's top-left corner.
    src = Image.new("RGB", (40, 20), (0, 0, 255))
    src.paste((255, 0, 0), (0, 0, 10, 10))
    buf = io.BytesIO()
    src.save(buf, "JPEG", exif=gps_exif(6), icc_profile=srgb, comment=b"secret note",
             xmp=b"<x:xmpmeta>28.53,-81.38</x:xmpmeta>", quality=90)
    jpeg_gps = buf.getvalue()
    before = Image.open(io.BytesIO(jpeg_gps))
    check(before.getexif().get_ifd(ExifTags.IFD.GPSInfo), "fixture should carry GPS tags")
    out, ct = strip_image_metadata(jpeg_gps)
    im = no_hidden_details("rotated JPEG", out)
    check(ct == "image/jpeg" and im.format == "JPEG", f"rotated JPEG stays JPEG: {ct} {im.format}")
    check(im.size == (20, 40), f"orientation applied: size {im.size}")
    r, g, b = im.getpixel((17, 2))
    check(r > 200 and b < 60, f"red corner should now be top-right, got {(r, g, b)}")
    r, g, b = im.getpixel((2, 2))
    check(b > 200 and r < 60, f"top-left should be blue after rotation, got {(r, g, b)}")

    # 2. An upright JPEG keeps its quantization tables (no extra loss).
    buf = io.BytesIO()
    src.save(buf, "JPEG", exif=gps_exif(1), comment=b"secret note", quality=75)
    upright = buf.getvalue()
    out, _ = strip_image_metadata(upright)
    im = no_hidden_details("upright JPEG", out)
    check(im.size == (40, 20), "upright JPEG keeps its size")
    check(im.quantization == Image.open(io.BytesIO(upright)).quantization,
          "upright JPEG should keep its quantization tables")

    # 3. A palette PNG with text chunks, eXIf, XMP and a profile keeps its
    #    transparency and nothing else.
    pal = Image.new("P", (10, 10))
    pal.putpalette([0, 0, 0, 255, 0, 0] + [0] * 762)
    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "secret note")
    info.add_itxt("XML:com.adobe.xmp", "<x:xmpmeta>gps</x:xmpmeta>")
    buf = io.BytesIO()
    pal.save(buf, "PNG", pnginfo=info, exif=gps_exif(1), icc_profile=srgb, transparency=0)
    out, ct = strip_image_metadata(buf.getvalue())
    im = no_hidden_details("PNG", out)
    check(ct == "image/png" and im.mode == "P", f"PNG stays a palette PNG: {ct} {im.mode}")
    check(im.info.get("transparency") == 0, f"PNG transparency kept: {im.info}")
    for chunk in (b"eXIf", b"iCCP", b"tEXt", b"iTXt", b"zTXt"):
        check(chunk not in out, f"PNG: {chunk!r} chunk left")

    # 4. A lossless WebP with EXIF, XMP and a profile stays lossless.
    rgba = Image.new("RGBA", (16, 16), (10, 200, 30, 128))
    buf = io.BytesIO()
    rgba.save(buf, "WEBP", lossless=True, exif=gps_exif(1), xmp=b"<x:xmpmeta>gps</x:xmpmeta>", icc_profile=srgb)
    out, ct = strip_image_metadata(buf.getvalue())
    im = no_hidden_details("WebP", out)
    check(ct == "image/webp", f"WebP stays WebP: {ct}")
    check(storage._webp_is_lossless(out), "lossless WebP should stay lossless")
    check(im.getpixel((3, 3)) == (10, 200, 30, 128), f"lossless pixels unchanged: {im.getpixel((3, 3))}")
    for chunk in (b"EXIF", b"XMP ", b"ICCP"):
        check(chunk not in out, f"WebP: {chunk!r} chunk left")

    # 5. An animated WebP keeps every frame and its timing.
    frames = [Image.new("RGBA", (12, 8), c) for c in ((255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255))]
    buf = io.BytesIO()
    frames[0].save(buf, "WEBP", save_all=True, append_images=frames[1:], duration=[100, 200, 300],
                   loop=0, exif=gps_exif(1), lossless=True)
    out, _ = strip_image_metadata(buf.getvalue())
    im = no_hidden_details("animated WebP", out)
    check(getattr(im, "n_frames", 1) == 3, f"animated WebP frames: {getattr(im, 'n_frames', 1)}")
    timing = []
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)
        im.load()
        timing.append(im.info.get("duration"))
    check(timing == [100, 200, 300], f"animated WebP timing: {timing}")

    # 6. The stored type is the real format, whatever the browser said;
    #    anything that isn't a readable JPEG, PNG or WebP is refused, and
    #    so is a small file that decodes to an enormous image.
    _, ct = strip_image_metadata(jpeg_gps)
    check(ct == "image/jpeg", "type comes from the file's contents")
    gif = io.BytesIO()
    Image.new("RGB", (4, 4)).save(gif, "GIF")
    bomb = io.BytesIO()
    Image.new("L", (8000, 8000)).save(bomb, "PNG")
    for label, raw in (("garbage", b"not an image"), ("GIF", gif.getvalue()), ("64 megapixels", bomb.getvalue())):
        try:
            strip_image_metadata(raw)
            check(False, f"{label} should be refused")
        except ImageRejected:
            pass

    # 7. End to end: a rep uploads the GPS JPEG; what is stored has no
    #    EXIF, and a non-image is answered with a 400.
    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.db import SessionLocal
    from app.models.pages import PostImage, RepAccount

    upload_dir = Path(tempfile.mkdtemp())
    storage.reset_storage_for_tests()
    storage._STORAGE_SINGLETON = storage.LocalDiskStorage(upload_dir)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            rep = RepAccount(email="uploader@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Uploader Example", official_id="image-test-official", is_active=True)
            db.add(rep)
            db.commit()
            rep_id = rep.id
        tok = issue_session_token(rep_id)
        h = {"Authorization": f"Bearer {tok}", "X-CSRF-Token": compute_csrf_token(tok)}
        c.cookies.clear()
        # Declared as PNG on purpose: the stored type follows the contents.
        r = c.post("/api/pages/images/upload", headers=h,
                   files={"file": ("photo.png", jpeg_gps, "image/png")})
        check(r.status_code == 200, f"upload status {r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            body = r.json()
            check(body.get("content_type") == "image/jpeg", f"stored type: {body.get('content_type')}")
            with SessionLocal() as db:
                row = db.get(PostImage, body["id"])
                stored = (upload_dir / row.filename).read_bytes()
                check(row.filename.endswith(".jpg"), f"stored name: {row.filename}")
                check(row.file_size == len(stored), "file_size matches the stored bytes")
            im = no_hidden_details("stored upload", stored)
            check(im.size == (20, 40), f"stored upload is upright: {im.size}")
            c.cookies.clear()
            served = c.get(body["url"])
            check(served.status_code == 200 and served.content == stored, "served bytes are the clean bytes")
        c.cookies.clear()
        r = c.post("/api/pages/images/upload", headers=h,
                   files={"file": ("x.jpg", b"definitely not a jpeg", "image/jpeg")})
        check(r.status_code == 400, f"non-image upload should be 400, got {r.status_code}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: uploaded images keep no hidden metadata")
    return 0


if __name__ == "__main__":
    sys.exit(main())
