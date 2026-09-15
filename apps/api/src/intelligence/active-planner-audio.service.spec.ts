import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ACTIVE_PLANNER_AUDIO_LANGUAGES,
  ActivePlannerAudioService,
} from "./active-planner-audio.service";

const audioFile = (type = "audio/webm") =>
  ({
    buffer: Buffer.from("recording"),
    mimetype: type,
    originalname: "request.webm",
  }) as Express.Multer.File;

describe("ActivePlannerAudioService", () => {
  it("publishes English, Indian languages and Arabic", () => {
    const service = new ActivePlannerAudioService({} as any);
    const codes = service.languages().map((language) => language.code);
    expect(codes).toEqual(
      expect.arrayContaining(["en", "hi", "ta", "bn", "ur", "ar"]),
    );
    expect(codes).toHaveLength(ACTIVE_PLANNER_AUDIO_LANGUAGES.length);
  });

  it("transcribes a bounded recording without retaining it", async () => {
    const ai = {
      transcribeAudio: jest.fn().mockResolvedValue({
        text: "Create a purchase order for 100 cartons",
        model: "gpt-transcribe",
      }),
    };
    const service = new ActivePlannerAudioService(ai as any);
    await expect(service.transcribe(audioFile(), "hi")).resolves.toMatchObject({
      transcript: "Create a purchase order for 100 cartons",
      language: "hi",
      retained: false,
      next_step: "REVIEW_TRANSCRIPT",
    });
    expect(ai.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ language: "hi", mimeType: "audio/webm" }),
    );
  });

  it("rejects missing, invalid-format and unsupported-language input", async () => {
    const service = new ActivePlannerAudioService({} as any);
    await expect(service.transcribe(undefined, "en")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.transcribe(audioFile("application/pdf"), "en"),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.transcribe(audioFile(), "xx")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("returns a tenant-scoped spoken response and degrades cleanly", async () => {
    const ai = {
      synthesizeSpeech: jest.fn().mockResolvedValue({
        audio: Buffer.from("mp3"),
        model: "gpt-4o-mini-tts",
      }),
    };
    const service = new ActivePlannerAudioService(ai as any);
    await expect(
      service.speech(
        "tenant-1",
        { userId: "user-1" },
        { text: "Sales are 10 lakh", language: "ar" },
      ),
    ).resolves.toMatchObject({ model: "gpt-4o-mini-tts" });
    expect(ai.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "tenant:tenant-1",
        actorId: "user-1",
        languageCode: "ar",
      }),
    );
    ai.synthesizeSpeech.mockRejectedValueOnce(new Error("provider down"));
    await expect(
      service.speech(
        "tenant-1",
        { userId: "user-1" },
        { text: "Answer", language: "en" },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
