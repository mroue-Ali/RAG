from app.config import Config
from app.services.crypto import Cipher


def test_round_trip():
    cipher = Cipher("a secret")
    stored = cipher.encrypt("sk-something")

    assert stored != "sk-something" and "sk-something" not in stored
    assert cipher.decrypt(stored) == "sk-something"


def test_the_same_text_never_encrypts_the_same_way_twice():
    cipher = Cipher("a secret")

    assert cipher.encrypt("sk-something") != cipher.encrypt("sk-something")


def test_a_different_key_cannot_read_it():
    stored = Cipher("the old secret").encrypt("sk-something")

    assert Cipher("a new secret").decrypt(stored) == ""


def test_values_stored_before_encryption_still_read():
    assert Cipher("a secret").decrypt("sk-plain-from-before") == "sk-plain-from-before"


def test_local_mode_makes_its_own_key_once(tmp_path):
    config = Config(_env_file=None, app_mode="local", data_dir=tmp_path, secret_key="")

    stored = Cipher.from_config(config).encrypt("sk-something")
    key_file = tmp_path / "secret.key"
    assert key_file.exists()

    # A restart reads the same key back, so what was stored stays readable.
    assert Cipher.from_config(config).decrypt(stored) == "sk-something"
