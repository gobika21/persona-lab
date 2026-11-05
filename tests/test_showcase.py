from personalab.showcase import DATA, export


def test_showcase_data_matches_the_server(tmp_path):
    """The static showcase reads web/public/data; it must match the API. If this fails: python -m personalab.showcase"""
    fresh = {p.relative_to(tmp_path): p.read_text() for p in export(tmp_path)}
    committed = {p.relative_to(DATA): p.read_text() for p in DATA.rglob("*.json")}
    assert fresh == committed
