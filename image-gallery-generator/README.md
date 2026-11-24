# AI Art Gallery Generator

A Node.js app that generates one image each with OpenAI, Replicate, and fal.ai,
uses OpenAI vision to compare their quality, then creates two image-based
variations from the top-scoring image. It saves the
images and creates an HTML gallery in `output/`.

## Requirements

- Node.js 18 or newer
- API keys for OpenAI, Replicate, and fal.ai

## Setup

From this folder, install the dependencies:

```powershell
npm install
```

Set the three keys in your PowerShell session:

```powershell
$env:OPENAI_API_KEY="your_openai_key"
$env:REPLICATE_API_TOKEN="your_replicate_token"
$env:FAL_KEY="your_fal_key"
```

Run the app and enter a theme when prompted:

```powershell
npm start
```

Or pass the theme as an argument:

```powershell
npm start -- "space exploration"
```

The generated images and `index.html` are saved under a timestamped folder in
`output/`. The output folder is ignored by Git so generated files and API
responses are not accidentally committed.
