// "Connect with Google" (Settings page) and the page Google returns to.
export const GOOGLE_STATE_KEY = "ff-google-oauth-state";
export const googleRedirectUri = () => `${window.location.origin}/settings/google-callback`;
