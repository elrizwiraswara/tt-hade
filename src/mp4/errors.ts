export type Mp4ErrorCode =
  | 'not_mp4'
  | 'unsupported_layout'
  | 'unsupported_codec'
  | 'missing_audio'
  | 'header_too_large'
  | 'already_patched'
  | 'malformed_box'
  | 'offset_out_of_range'
  | 'verification_failed';

export class Mp4Error extends Error {
  override readonly name = 'Mp4Error';

  constructor(
    readonly code: Mp4ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
