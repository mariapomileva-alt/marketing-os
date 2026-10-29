export const IG_PUBLISH_SCOPE = "instagram_business_content_publish";
/** Instagram's answer when the app or the token lacks the publishing permission. */
export const isIgPermissionError = (message: string) => /IGApiException 10\b|does not have permission|\(#10\)/i.test(message);
