from . import Rotator, Target


class SimulatedRotator(Rotator):
    """Accepts every change and check. For development only: the target keeps its old password."""

    def rotate(self, target: Target, current: str, new: str) -> None:
        return None

    def verify(self, target: Target, password: str) -> bool:
        return True
