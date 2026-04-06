# Frontend Design Examples

## Typography Pairings

### Modern & Clean
```css
/* Display */
font-family: 'Clash Display', sans-serif;
/* Body */
font-family: 'Satoshi', sans-serif;
```

### Editorial & Refined
```css
/* Display */
font-family: 'Playfair Display', serif;
/* Body */
font-family: 'Source Sans Pro', sans-serif;
```

### Playful & Friendly
```css
/* Display */
font-family: 'Fredoka One', cursive;
/* Body */
font-family: 'Nunito', sans-serif;
```

### Japanese-Friendly Options
```css
/* Display */
font-family: 'Noto Sans JP', sans-serif;
font-weight: 900;

/* Body */
font-family: 'Noto Sans JP', sans-serif;
font-weight: 400;

/* Alternative - More Modern */
font-family: 'M PLUS Rounded 1c', sans-serif;
```

## MUI Theme Customization Examples

### Vibrant Color Palette
```typescript
const theme = createTheme({
  palette: {
    primary: {
      main: '#FF6B35', // Vibrant orange
      light: '#FF8F5E',
      dark: '#E55A2B',
    },
    secondary: {
      main: '#004E64', // Deep teal
      light: '#25A18E',
      dark: '#00303D',
    },
    background: {
      default: '#FFFBF5', // Warm white
      paper: '#FFFFFF',
    },
  },
});
```

### Dark Mode Elegant
```typescript
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#A78BFA', // Soft purple
    },
    background: {
      default: '#0F0F0F',
      paper: '#1A1A1A',
    },
  },
});
```

## Animation Patterns

### Staggered Entry Animation
```tsx
import { keyframes } from '@mui/material/styles';

const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

// Usage with stagger
<Box
  sx={{
    animation: `${fadeInUp} 0.6s ease-out`,
    animationDelay: `${index * 0.1}s`,
    animationFillMode: 'both',
  }}
>
  {content}
</Box>
```

### Hover Scale Effect
```tsx
<Card
  sx={{
    transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
    '&:hover': {
      transform: 'scale(1.02)',
    },
  }}
>
```

### Gradient Background Animation
```tsx
const gradientShift = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

<Box
  sx={{
    background: 'linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab)',
    backgroundSize: '400% 400%',
    animation: `${gradientShift} 15s ease infinite`,
  }}
>
```

## Layout Patterns

### Asymmetric Grid
```tsx
<Box
  sx={{
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gridTemplateRows: 'auto auto',
    gap: 2,
    '& > :first-of-type': {
      gridRow: 'span 2',
    },
  }}
>
```

### Overlapping Cards
```tsx
<Box sx={{ position: 'relative' }}>
  <Card
    sx={{
      position: 'relative',
      zIndex: 2,
      transform: 'rotate(-2deg)',
    }}
  />
  <Card
    sx={{
      position: 'absolute',
      top: 20,
      left: 20,
      zIndex: 1,
      transform: 'rotate(3deg)',
    }}
  />
</Box>
```

## Background Patterns

### Noise Texture Overlay
```tsx
<Box
  sx={{
    position: 'relative',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      backgroundImage: 'url("/noise.png")',
      opacity: 0.05,
      pointerEvents: 'none',
    },
  }}
>
```

### Gradient Mesh
```tsx
<Box
  sx={{
    background: `
      radial-gradient(at 40% 20%, #ff6b35 0px, transparent 50%),
      radial-gradient(at 80% 0%, #25a18e 0px, transparent 50%),
      radial-gradient(at 0% 50%, #004e64 0px, transparent 50%)
    `,
    backgroundColor: '#fffbf5',
  }}
>
```

## Mobile-First Considerations

### Touch-Friendly Buttons
```tsx
<Button
  sx={{
    minHeight: 48, // Minimum touch target
    minWidth: 48,
    px: 3,
    borderRadius: 3,
    // Haptic feedback visual
    '&:active': {
      transform: 'scale(0.98)',
    },
  }}
>
```

### Bottom Navigation Pattern
```tsx
<Paper
  sx={{
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    pb: 'env(safe-area-inset-bottom)', // iOS safe area
    borderRadius: '16px 16px 0 0',
    boxShadow: '0 -4px 20px rgba(0,0,0,0.1)',
  }}
>
```

### Card with Swipe Gesture Area
```tsx
<Card
  sx={{
    touchAction: 'pan-y', // Allow vertical scroll, enable horizontal swipe
    cursor: 'grab',
    '&:active': {
      cursor: 'grabbing',
    },
  }}
>
```
