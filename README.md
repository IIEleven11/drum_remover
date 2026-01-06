# Drum Remover

## Personal website for my father so we can easily remove the drums from songs so he can drum along himself

### Uses yt-dlp to download audio from YouTube links

### Uses Demucs to separate the drums from the rest of the audio

You just type the name of the song you want, it will then search and display some options. Then you pick one and it will seperate and remove the drums. 

Youll also notice the history log. If you want to go back a song you can click on those as you see fit.

## Performance Tuning

The Demucs processing speed can be tuned via environment variables. Set these in your VPS/Docker environment:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMUCS_MODEL` | `htdemucs` | Model to use. Options: `htdemucs` (best quality), `hdemucs_mmi` (faster), `mdx_extra` (fastest) |
| `DEMUCS_SEGMENT` | `5` | Segment size in seconds. Lower = faster but may reduce quality. Range: 3-10 |
| `DEMUCS_JOBS` | `2` | Parallel segment processing. Increase if you have more RAM (each job uses ~2GB) |
| `OMP_NUM_THREADS` | `4` | CPU threads per job. Set to your VPS core count |
| `DEMUCS_MP3_BITRATE` | `192` | Output MP3 bitrate in kbps |

### Quick Performance Presets

**Fastest (lower quality):**
```bash
DEMUCS_MODEL=hdemucs_mmi
DEMUCS_SEGMENT=4
DEMUCS_JOBS=1
OMP_NUM_THREADS=2
```

**Balanced (recommended):**
```bash
DEMUCS_MODEL=htdemucs
DEMUCS_SEGMENT=5
DEMUCS_JOBS=2
OMP_NUM_THREADS=4
```

**Best Quality (slowest):**
```bash
DEMUCS_MODEL=htdemucs
DEMUCS_SEGMENT=7
DEMUCS_JOBS=1
OMP_NUM_THREADS=4
```

