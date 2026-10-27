"""Regression coverage for the playlist page-order database index."""

from sqlalchemy import Index

from backend.app.models.playlist import PlaylistTrack


def test_playlist_membership_has_composite_page_order_index() -> None:
    indexes = {
        index.name: tuple(column.name for column in index.columns)
        for index in PlaylistTrack.__table__.indexes
        if isinstance(index, Index)
    }

    assert indexes["ix_playlist_tracks_page_order"] == (
        "playlist_id",
        "position",
        "created_at",
        "id",
    )
