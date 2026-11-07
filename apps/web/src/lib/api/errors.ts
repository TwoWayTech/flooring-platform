/**
 * An error the API reports to the person using the app: a broken business rule or a failed
 * request. Its message is written for them, so screens can show it as it is.
 */
export class ApiError extends Error {}
