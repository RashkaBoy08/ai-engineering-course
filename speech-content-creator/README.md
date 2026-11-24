# Voice-Powered Content Creator

A Node.js app that accepts an audio recording, transcribes it with OpenAI,
creates a summary and an enhanced transcript, and generates speech with both
OpenAI and ElevenLabs. It saves the text, both audio files, and an HTML report.

The report compares each generated voice by transcribing it and measuring its
word/segment error rate against the enhanced text. This is a text-fidelity
comparison, not a judgment of voice style or sound quality.

## Requirements

- Node.js 18 or newer
- An OpenAI API key
- An ElevenLabs API key and voice ID
- An audio file in a format supported by OpenAI transcription (for example
  MP3, WAV, M4A, MP4, or WebM), up to 25 MB

## Setup

From this folder, install the dependencies:

```powershell
npm install
```

Copy `.env.example` to `.env` and add your API keys and ElevenLabs voice ID.
Alternatively, set these variables in PowerShell:

```powershell
$env:OPENAI_API_KEY="your_openai_key"
$env:ELEVENLABS_API_KEY="your_elevenlabs_key"
$env:ELEVENLABS_VOICE_ID="your_elevenlabs_voice_id"
```

Pass the audio file path to the app:

```powershell
npm start -- "C:\path\to\recording.wav"
```

By default, OpenAI detects the language. To specify a two-letter language code:

```powershell
npm start -- "C:\path\to\recording.wav" --language es
```

You can also run `npm start` without arguments and enter the file path when
prompted. The transcription's detected language is used for the summary,
enhanced text, and speech generation.

Each run saves its transcript, summary, enhanced text, two MP3 files,
comparison JSON, and `report.html` in a timestamped folder under `output/`.
Generated output and local credentials are ignored by Git.
