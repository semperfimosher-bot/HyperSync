from http.client import HTTPMessage
from io import BytesIO
from urllib.request import Request

import pytest

from scripts.verification.smoke import NoRedirect, smoke_targets


@pytest.mark.parametrize('url', [
    'http://example.com', 'https://user:pass@example.com',
    'https://example.com/api/delete', 'https://example.com?token=secret',
    'https://example.com/#token', 'file:///tmp/file',
])
def test_smoke_rejects_non_origin_or_insecure_target(url):
    with pytest.raises(ValueError):
        smoke_targets(url)


def test_only_fixed_read_only_targets():
    assert smoke_targets('https://example.com/') == (
        'https://example.com/', 'https://example.com/health/ready',
    )


def test_redirects_are_never_followed():
    assert NoRedirect().redirect_request(
        Request('https://example.com'), BytesIO(), 302, '', HTTPMessage(), 'https://other.test'
    ) is None
