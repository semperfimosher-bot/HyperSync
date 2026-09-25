from types import SimpleNamespace

from backend.app.api.routes import (
    admin as admin_route,
)


def _payload(
    *,
    filename: str,
    bitrate_kbps: float | None,
):
    return (
        admin_route
        .PrepareDirectTrackUploadRequest(
            filename=filename,
            mime_type="audio/mpeg",
            file_size=5_000_000,
            duration_seconds=180,
            title="Song",
            artist="Artist",
            album="Album",
            genre="Pop",
            estimated_bitrate_kbps=(
                bitrate_kbps
            ),
        )
    )


def _settings(
    *,
    compression_enabled: bool = True,
):
    return SimpleNamespace(
        b2_direct_upload_enabled=True,
        audio_compression_enabled=(
            compression_enabled
        ),
        audio_compression_min_source_kbps=224,
    )


def test_efficient_lossy_audio_can_use_direct_b2(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: _settings(),
    )

    assert (
        admin_route
        ._direct_upload_is_safe(
            _payload(
                filename="track.mp3",
                bitrate_kbps=192,
            )
        )
        is True
    )


def test_high_bitrate_audio_stays_on_backend_processing_path(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: _settings(),
    )

    assert (
        admin_route
        ._direct_upload_is_safe(
            _payload(
                filename="track.mp3",
                bitrate_kbps=320,
            )
        )
        is False
    )


def test_lossless_audio_stays_on_backend_processing_path(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: _settings(),
    )

    payload = _payload(
        filename="track.wav",
        bitrate_kbps=1411.2,
    )

    payload.mime_type = (
        "audio/wav"
    )

    assert (
        admin_route
        ._direct_upload_is_safe(
            payload,
        )
        is False
    )


def test_unknown_bitrate_uses_safe_backend_fallback(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: _settings(),
    )

    assert (
        admin_route
        ._direct_upload_is_safe(
            _payload(
                filename="track.mp3",
                bitrate_kbps=None,
            )
        )
        is False
    )


def test_direct_upload_can_be_disabled_without_affecting_legacy_path(
    monkeypatch,
) -> None:
    settings = _settings()

    settings.b2_direct_upload_enabled = (
        False
    )

    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: settings,
    )

    assert (
        admin_route
        ._direct_upload_is_safe(
            _payload(
                filename="track.mp3",
                bitrate_kbps=192,
            )
        )
        is False
    )
