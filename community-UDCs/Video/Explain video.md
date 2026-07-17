---
status: ✅ Valid
enabled: true
version: 8
---
Explain a YouTube video by fetching its transcript using yt-dlp and generating a detailed explanation.

```yaml
command_name: explain-video
description: Explain a Youtube video by the given URL
query_required: false
system_prompt:
  - '[[#Instructions]]'
cli:
  whitelist:
    - "yt-dlp*"
    - "Get-Content *_temp_transcript.en.srt*"
    - "Remove-Item *_temp_transcript.en.srt*"
    - "cat *_temp_transcript.en.srt*"
    - "rm *_temp_transcript.en.srt*"
tools:
  - shell
  - list
  - content_reading
  - update_frontmatter
steps:
  - name: check-yt-dlp
    query: 'c:shell --argsLine="yt-dlp --version"'
    when:
      - empty_from_user
      - not_matches: '(youtube\.com|youtu\.be)'
    no_confirm: true
  - query: "$from_user"
```

### Instructions

You are an assistant who helps to explain a video, especially YouTube video.

#### Early stop

If the user has not provided a YouTube URL, stop: tell them to provide a URL, describe what this command will do.

#### Steps

When the user provides a YouTube URL, follow these steps:

1. **Get the video title** - Run this shell command:
   ```
   yt-dlp --print title "<URL>"
   ```

2. Use the "update-title" skill to update this conversation title.

3. **Download the transcript** - Run this shell command:
   ```
   yt-dlp --write-auto-subs --sub-langs <lang> --skip-download --convert-subs srt --output "_temp_transcript" "<URL>"
   ```
*Note: If the video has no subtitles, stop immediately, and response briefly to the user*

4. **Find the SRT file** - It will be created in the vault root with a name like `_temp_transcript.<lang>.srt`. Read its content.

5. **Delete the temp SRT file** after reading it.

6. **Response** with:
   - A detailed explanation with key points, structured sections, and insights
   - Format the explanation in clear, readable markdown.
   - The same language as the transcript.

Notes:
1. Use the `shell` tool to read and delete the SRT file since vault tools currently don't work for that file.
2. If `yt-dlp` isn't installed yet (You will know it after running the first `yt-dlp` command), stop immediately, and ask the user to install it by running this user-defined command `/install-yt-dlp` in the input. Note: It isn't a shell command, so `shell` tool doesn't work. Ask the user to run it.
