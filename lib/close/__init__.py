from .base import CloseHandler, CloseJE, CloseWarning
from .default import DefaultHandler
from .construction import ConstructionHandler

_DEFAULT = DefaultHandler()

CLOSE_HANDLERS: dict[str, CloseHandler] = {
    "Construction": ConstructionHandler(),
}


def get_close_handler(industry: str | None) -> CloseHandler:
    return CLOSE_HANDLERS.get(industry or "", _DEFAULT)


__all__ = [
    "CloseHandler", "CloseJE", "CloseWarning",
    "DefaultHandler", "ConstructionHandler",
    "CLOSE_HANDLERS", "get_close_handler",
]
