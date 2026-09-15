import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AiProviderService } from "../ai/ai-provider.service";

export const ACTIVE_PLANNER_AUDIO_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" },
  { code: "or", name: "Odia" },
  { code: "as", name: "Assamese" },
  { code: "ar", name: "Arabic" },
] as const;

const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
]);

@Injectable()
export class ActivePlannerAudioService {
  constructor(private readonly ai: AiProviderService) {}

  languages() {
    return ACTIVE_PLANNER_AUDIO_LANGUAGES.map((language) => ({ ...language }));
  }

  private language(raw: any) {
    const code = String(raw || "en")
      .trim()
      .toLowerCase();
    const language = ACTIVE_PLANNER_AUDIO_LANGUAGES.find(
      (x) => x.code === code,
    );
    if (!language)
      throw new BadRequestException("Select a supported voice language.");
    return language;
  }

  async transcribe(file: Express.Multer.File | undefined, rawLanguage: any) {
    if (!file?.buffer?.length)
      throw new BadRequestException("Record a voice request first.");
    const mimeType = String(file.mimetype || "")
      .split(";")[0]
      .toLowerCase();
    if (!AUDIO_TYPES.has(mimeType))
      throw new BadRequestException(
        "Unsupported recording format. Use WebM, MP4, MP3, M4A or WAV audio.",
      );
    const language = this.language(rawLanguage);
    try {
      const result = await this.ai.transcribeAudio({
        buffer: file.buffer,
        fileName: String(
          file.originalname ||
            `voice-request.${mimeType === "audio/mp4" ? "mp4" : "webm"}`,
        ).slice(0, 180),
        mimeType,
        language: language.code,
      });
      if (!result.text)
        throw new BadRequestException(
          "No speech was detected. Please record again.",
        );
      return {
        transcript: result.text,
        language: language.code,
        language_name: language.name,
        model: result.model,
        retained: false,
        next_step: "REVIEW_TRANSCRIPT",
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(
        "Voice transcription is temporarily unavailable. You can continue by typing.",
      );
    }
  }

  async speech(tenantId: string, user: any, body: any) {
    const text = String(body?.text || "").trim();
    if (!text)
      throw new BadRequestException("There is no answer to read aloud.");
    if (text.length > 4096)
      throw new BadRequestException(
        "The spoken answer is too long. Ask for a shorter summary.",
      );
    const language = this.language(body?.language);
    try {
      return await this.ai.synthesizeSpeech({
        text,
        languageCode: language.code,
        languageName: language.name,
        scope: `tenant:${tenantId}`,
        actorId: user?.userId || user?.id,
      });
    } catch {
      throw new ServiceUnavailableException(
        "Spoken response is temporarily unavailable. The written answer is still available.",
      );
    }
  }
}
