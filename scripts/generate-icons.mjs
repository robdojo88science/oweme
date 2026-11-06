import sharp from "sharp";
for (const [size, name] of [
  [192, "icon-192"],
  [512, "icon-512"],
  [180, "apple-touch-icon"],
]) {
  await sharp("public/icon.svg")
    .resize(size)
    .png()
    .toFile(`public/${name}.png`);
}
for (const [width, height] of [
  [1170, 2532],
  [1284, 2778],
  [1668, 2388],
]) {
  const size = Math.round(width * 0.22);
  const icon = await sharp("public/icon.svg").resize(size).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: "#F7F8FB" } })
    .composite([
      {
        input: icon,
        left: Math.floor((width - size) / 2),
        top: Math.floor((height - size) / 2),
      },
    ])
    .png()
    .toFile(`public/splash-${width}x${height}.png`);
}
