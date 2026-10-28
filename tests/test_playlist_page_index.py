"""Regression coverage for the playlist page-order database index."""

from typing import cast

from sqlalchemy import Index, Table

from backend.app.models.playlist import PlaylistTrack


def test_playlist_membership_has_composite_page_order_index() -> None:
    table = cast(Table, PlaylistTrack.__table__)
    indexes: dict[str, tuple[str, ...]] = {
        str(index.name): tuple(column.name for column in index.columns)
        for index in table.indexes
        if isinstance(index, Index) and index.name is not None
    }

    assert indexes["ix_playlist_tracks_page_order"] == (
        "playlist_id",
        "position",
        "created_at",
        "id",
    )
