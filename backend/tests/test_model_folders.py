import json

from app.services.llm import transformers_local


def _model(folder, architecture="LlamaForCausalLM"):
    folder.mkdir(parents=True)
    (folder / "config.json").write_text(json.dumps({"architectures": [architecture]}))
    (folder / "model.safetensors").write_bytes(b"0" * 10)


def test_models_are_found_in_nested_folders(tmp_path):
    _model(tmp_path / "Qwen" / "Qwen2.5-0.5B-Instruct")
    _model(tmp_path / "bert", architecture="BertModel")
    (tmp_path / "empty").mkdir()

    models = transformers_local.list_models(str(tmp_path))

    assert [model.name for model in models] == ["Qwen/Qwen2.5-0.5B-Instruct"]
    assert models[0].id == str(tmp_path / "Qwen" / "Qwen2.5-0.5B-Instruct")
    assert models[0].size_bytes > 0

