import asyncio
import sys

import edge_tts


async def main():
    if len(sys.argv) < 4:
        raise SystemExit("usage: synthesize_edge_tts.py <voice> <output> <text> [rate]")

    voice = sys.argv[1]
    output = sys.argv[2]
    text = sys.argv[3]
    rate = sys.argv[4] if len(sys.argv) > 4 else "+0%"

    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    await communicate.save(output)


if __name__ == "__main__":
    asyncio.run(main())
