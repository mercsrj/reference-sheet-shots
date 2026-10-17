# reference-sheet-shots

Screenshot service for the Daily Reference Sheet gallery.

Each morning the curator pushes `queue/<date>.json` with the day's websites. The **Screenshots** workflow then opens every site in a headless Chrome at 1440px and commits two images per site to `shots/<date>/`:

- `<id>-hero.jpg`: the first screen (1440 × 900)
- `<id>-full.jpg`: the whole homepage, scaled to 1200px wide and capped at 14,000px tall

A `manifest.json` lists which sites succeeded. The curator then uploads the images to the gallery.

To re-run a day, delete `shots/<date>/` and run the workflow from the Actions tab.
