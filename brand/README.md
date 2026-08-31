# litechat brand source

`litechat-symbol.svg` is the canonical production symbol. It is deliberately a
single-color vector so the generator can derive full-color, dark, monochrome,
tinted, adaptive, favicon, social, and store variants without duplicating path
data.

The three evaluated concepts are kept in `design/brand-explorations/`. The
selected soft conversation pebble has the clearest small-size silhouette, keeps
its inner opening in monochrome, and remains optically centered under circular
and squircle masks.

`palette.json` mirrors the color tokens in `DESIGN.md` and is consumed by the
asset generator. Product theme files repeat the small palette locally so app
packages remain build-independent.
