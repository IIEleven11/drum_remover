---
title: Drum Remover
emoji: 🥁
colorFrom: purple
colorTo: blue
sdk: docker
pinned: false
---

# Drum Remover

A web application that removes drums from any song using AI (Demucs). Simply paste a YouTube link and get a drumless version of the track.

## How it works

1. Paste a YouTube video URL
2. The app downloads the audio using yt-dlp
3. Demucs AI separates the drums from the rest of the audio
4. Download your drumless track!

## Tech Stack

- **Frontend:** Next.js, React, Tailwind CSS
- **AI Model:** Demucs (Hybrid Transformer)
- **Audio Download:** yt-dlp
- **Runtime:** Docker

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
