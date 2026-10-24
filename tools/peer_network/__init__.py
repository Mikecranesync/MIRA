"""Executable semantics of the peer-network contract (FLEET-PEER-NETWORK-001).

Pure functions, no I/O: canonical resource keys and overlap, the claim race,
lease validity, handoff and scope expansion. Foreman (Slice B+) must use these
rather than re-deriving them from prose; the contract tests pin the behaviour.
"""
