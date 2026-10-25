import { getMe, type Me } from "../../api/resources";

/** Thrown when a sign-in succeeded but the account could not be loaded. */
export class AccountLoadError extends Error {
  constructor() {
    super("account_load_failed");
    this.name = "AccountLoadError";
  }
}

/**
 * Loads the account for a session that a sign-in just established (#4774).
 *
 * getMe() fails closed to null, which is right for boot but wrong here: a null
 * account right after a successful sign-in means the account load failed, not
 * that the user is signed out. Returning it would leave the login screen up
 * with no error, and an invitation retry would then wipe the fresh cookie and
 * replay the already-consumed single-use token. Throwing lets the sign-in
 * screens show their retry path instead.
 */
export async function loadSignedInAccount(): Promise<Me> {
  const me = await getMe();
  if (!me) throw new AccountLoadError();
  return me;
}
