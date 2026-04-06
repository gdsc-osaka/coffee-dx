---
name: frontend-design
description: |
  フロントエンドUIコンポーネントやページを実装するための高品質デザインガイド。
  汎用的なAI生成デザインを避け、独自性のある美しいインターフェースを作成します。
  「コンポーネント作成」「ページデザイン」「UI実装」「フロントエンド開発」などのキーワードで起動。
---

# Frontend Design Skill

Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when building web components, pages, or applications in the client directory. Generates creative, polished code that avoids generic AI aesthetics.

## When to Use

- Creating new React components in `client/app/` or `client_admin/app/`
- Building new pages in `client/app/` or `client_admin/app/`
- Designing theme configurations in `client/theme/` or `client_admin/theme/`
- Any UI/UX work that requires visual design decisions

## Design Thinking Process

Before coding, understand the context and commit to a **BOLD aesthetic direction**:

1. **Purpose**: What problem does this interface solve? Who uses it?
2. **Tone**: Pick a direction that fits the context:
   - Brutally minimal
   - Maximalist chaos
   - Retro-futuristic
   - Organic/natural
   - Luxury/refined
   - Playful/toy-like
   - Editorial/magazine
   - Brutalist/raw
   - Art deco/geometric
   - Soft/pastel
   - Industrial/utilitarian
3. **Constraints**: Technical requirements (MUI components, performance, accessibility, mobile-first)
4. **Differentiation**: What makes this UNFORGETTABLE?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision.

## Implementation Requirements

All frontend code must be:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail
- **Mobile-first** (this project targets PWA on smartphones)

## Aesthetic Guidelines

### Typography
- Choose fonts that are beautiful, unique, and interesting
- **AVOID**: Generic fonts like Arial, Inter, Roboto, system fonts
- **PREFER**: Distinctive choices that elevate the frontend's aesthetics
- Pair a distinctive display font with a refined body font
- Consider using Google Fonts or custom fonts

### Color & Theme
- Commit to a cohesive aesthetic
- Use MUI theme system for consistency
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- **AVOID**: Cliched purple gradients on white backgrounds

### Motion & Animation
- Use animations for effects and micro-interactions
- Prioritize CSS-only solutions or MUI transitions
- Focus on high-impact moments:
  - Well-orchestrated page load with staggered reveals
  - Scroll-triggering effects
  - Hover states that surprise
- Use `animation-delay` for staggered animations

### Spatial Composition
- Unexpected layouts
- Asymmetry and overlap
- Diagonal flow
- Grid-breaking elements
- Generous negative space OR controlled density

### Backgrounds & Visual Details
- Create atmosphere and depth (not just solid colors)
- Apply creative forms:
  - Gradient meshes
  - Noise textures
  - Geometric patterns
  - Layered transparencies
  - Dramatic shadows
  - Decorative borders

## What to AVOID (Generic AI Aesthetics)

- Overused font families (Inter, Roboto, Arial)
- Cliched color schemes (purple gradients on white)
- Predictable layouts and component patterns
- Cookie-cutter design lacking context-specific character
- Same design choices across different components

## Project-Specific Considerations

### Tech Stack
- **Framework**: Next.js 16 with App Router
- **UI Library**: Material-UI (MUI) v7 - always use MUI components as base
- **Forms**: react-hook-form with zod validation
- **State**: TanStack Query for server state
- **React**: React 19

### Mobile-First PWA
- Design for smartphone screens first
- Tap targets: minimum 44x44px
- Consider touch gestures
- Optimize for performance (avoid unnecessary re-renders)
- Use Next.js Image for optimized images

### Consistency Check
- Always review other pages for design patterns
- Maintain visual consistency across the app
- Follow established patterns while adding distinctive elements

## Example Workflow

1. Understand the component/page purpose
2. Choose an aesthetic direction that fits
3. Sketch the visual hierarchy mentally
4. Implement using MUI components as base
5. Add distinctive typography, colors, and motion
6. Refine details for mobile-first experience
7. Test on various screen sizes
