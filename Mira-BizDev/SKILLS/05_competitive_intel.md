# Skill: Competitive Intelligence

## Trigger
"What's [competitor] doing?", "competitive update", "battlecard for [competitor]"

## What It Does
1. Web search for recent news, product launches, funding, and partnerships from competitors
2. Check if any email threads mention competitor names
3. Update the competitive intel file in COMPETITIVE_INTEL/
4. Generate or refresh battlecard with positioning against that competitor

## Key Competitors to Track
- Augmentir (AR connected worker)
- Tulip (no-code manufacturing apps)
- Fiix / UpKeep / eMaint (CMMS platforms)
- Limble CMMS
- Aquant (service intelligence)
- Dozuki (digital work instructions)
- PTC Vuforia (AR/IoT)

## Output Format
Save to: `COMPETITIVE_INTEL/[competitor]_[date].md`

```
# Competitive Intel: [Competitor]

## Recent Activity
- [news items with dates and sources]

## Product Positioning
- Their pitch: [how they describe themselves]
- Our advantage: [where MIRA wins]
- Their advantage: [where they're stronger — be honest]
- Overlap: [where we compete head-to-head]

## Battlecard
- When prospect mentions [competitor]: [response framework]
- Key differentiators to emphasize: [list]
- Landmines to avoid: [topics where competitor is stronger]
```

## Connected Tools Needed
- Web search
- Gmail (search for competitor mentions)
- File system (COMPETITIVE_INTEL/)
