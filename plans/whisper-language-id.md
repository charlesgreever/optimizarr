# Plan: Optional language identification for untagged audio

Title-page action: listen to a 45-second clip of an `und` soundtrack, detect the language, then either **Use** it on the inspection or **try another time** in the file. The library file does not change until Keep. Whisper is optional (`WHISPER_LID`). Tests fake the detector.

Title-page **Identify language** on an `und` soundtrack. Detect is `POST /api/library/items/:id/detect-language`; save is `POST .../apply-language`. The image ships `/usr/local/bin/whisper-lid` (faster-whisper tiny). Set `WHISPER_LID` to that path. First listen caches the model under `/config/whisper`. Library bytes do not change until Keep.
