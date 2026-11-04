import json

import pytest

from personalab.evals import serve_sites
from personalab.replay import remove, save
from personalab.server import create_app
from tests.helpers import HAVE_BROWSER, Scripted, tool

pytestmark = pytest.mark.skipif(not HAVE_BROWSER, reason="needs Playwright Chromium")


def script(persona, n, seen, kw):
    if n == 0:
        return [tool("report_barrier", title="Book button can't be reached", detail="A div.", severity="blocker", fix="Use a button.")]
    return [tool("finish", success=persona != "keyboard", summary="Done", worked=["Headings were clear"])]


@pytest.fixture(scope="module")
def finished_run():
    app = create_app(agent_client=Scripted(script))
    app.config["SYNC"] = True
    client = app.test_client()
    with serve_sites() as bench:
        gid = client.post("/api/run", json={"url": f"{bench}/hotel/index.html", "goal": "Book a room"}).json["id"]
    return gid, lambda path: client.get(path).data


def test_save_writes_record_shots_and_index(finished_run, tmp_path):
    gid, fetch = finished_run
    entry = save(gid, "hotel-book", fetch, tmp_path)
    folder = tmp_path / "hotel-book"
    record = json.loads((folder / "record.json").read_text())
    assert record["run"]["id"] == gid and record["run"]["finished"]
    shots = sorted(p.name for p in (folder / "shots").iterdir())
    expected = sorted(f"{j['id']}-{s['n']}.jpg" for j in record["journeys"] for s in j["steps"] if s.get("has_shot"))
    assert shots == expected and shots
    assert all((folder / "shots" / s).read_bytes()[:2] == b"\xff\xd8" for s in shots)  # JPEGs
    assert entry == {**entry, "id": "hotel-book", "goal": "Book a room", "completed": 3, "total": 4, "shots": len(shots)}
    assert json.loads((tmp_path / "index.json").read_text()) == [entry]

    save(gid, "hotel-book", fetch, tmp_path)  # saving again replaces, doesn't duplicate
    assert len(json.loads((tmp_path / "index.json").read_text())) == 1
    remove("hotel-book", tmp_path)
    assert not folder.exists() and json.loads((tmp_path / "index.json").read_text()) == []


def test_save_rejects_bad_names_and_unfinished_runs(finished_run, tmp_path):
    gid, fetch = finished_run
    with pytest.raises(ValueError, match="short name"):
        save(gid, "../evil", fetch, tmp_path)

    def unfinished(path):
        data = json.loads(fetch(path))
        data["run"]["finished"] = False
        return json.dumps(data).encode()
    with pytest.raises(ValueError, match="hasn't finished"):
        save(gid, "x", unfinished, tmp_path)
