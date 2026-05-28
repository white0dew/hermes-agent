from __future__ import annotations

import importlib
import sys
from pathlib import Path
import types


def _clear_transcription_import_state():
    for name in list(sys.modules):
        if name == "tools" or name.startswith("tools.") or name == "utils":
            sys.modules.pop(name, None)


def test_transcription_tools_imports_repo_utils_when_shadowed(tmp_path, monkeypatch):
    shadow_dir = tmp_path / "shadow"
    shadow_dir.mkdir()
    (shadow_dir / "utils.py").write_text("SENTINEL = True\n", encoding="utf-8")

    repo_root = Path(__file__).resolve().parents[2]
    monkeypatch.chdir(tmp_path)
    monkeypatch.syspath_prepend(str(shadow_dir))
    monkeypatch.syspath_prepend(str(repo_root))
    sys.modules.setdefault("yaml", types.SimpleNamespace(dump=lambda *a, **k: None))

    _clear_transcription_import_state()

    module = importlib.import_module("tools.transcription_tools")

    assert module.is_truthy_value("yes") is True
    assert getattr(sys.modules["utils"], "SENTINEL", False) is False
    assert Path(sys.modules["utils"].__file__).resolve() == repo_root / "utils.py"


def test_transcription_tools_replaces_preloaded_shadow_utils(tmp_path, monkeypatch):
    repo_root = Path(__file__).resolve().parents[2]
    shadow_utils = tmp_path / "utils.py"
    shadow_utils.write_text("SENTINEL = True\n", encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    monkeypatch.syspath_prepend(str(repo_root))
    sys.modules.setdefault("yaml", types.SimpleNamespace(dump=lambda *a, **k: None))
    _clear_transcription_import_state()
    sys.modules["utils"] = types.SimpleNamespace(
        __file__=str(shadow_utils),
        SENTINEL=True,
        is_truthy_value=lambda value, default=False: "shadowed",
    )

    module = importlib.import_module("tools.transcription_tools")

    assert module.is_truthy_value("yes") is True
    assert getattr(sys.modules["utils"], "SENTINEL", False) is False
    assert Path(sys.modules["utils"].__file__).resolve() == repo_root / "utils.py"
