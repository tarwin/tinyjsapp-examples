// Board background presets. The backend stores only the key; an uploaded
// image gets key 'image' plus a file served back as a data: URI.

export const BACKGROUNDS: Record<string, string> = {
  sky: 'linear-gradient(160deg, #2d6cc4 0%, #4c9ad4 60%, #6db8d9 100%)',
  sunset: 'linear-gradient(160deg, #a63a8b 0%, #d4576b 55%, #e88a52 100%)',
  forest: 'linear-gradient(160deg, #15654c 0%, #2e8b61 55%, #67b586 100%)',
  grape: 'linear-gradient(160deg, #45338f 0%, #6a4fc0 55%, #9077dd 100%)',
  flamingo: 'linear-gradient(160deg, #b74a7f 0%, #d9709e 55%, #eda5bc 100%)',
  midnight: 'linear-gradient(160deg, #16213a 0%, #2a3a5c 55%, #435577 100%)',
  slate: 'linear-gradient(160deg, #3f4a57 0%, #5c6a7a 55%, #7f8fa1 100%)',
  citrus: 'linear-gradient(160deg, #b87d1c 0%, #d9a13c 55%, #e8c063 100%)',
}

export const DEFAULT_BACKGROUND = 'sky'

export function backgroundCss(key: string): string {
  return BACKGROUNDS[key] ?? BACKGROUNDS[DEFAULT_BACKGROUND]
}

// Trello-ish label palette; boards can give each color a name
export const LABEL_COLORS: Record<string, string> = {
  green: '#4bab64',
  yellow: '#d9b032',
  orange: '#dd7a34',
  red: '#d34c4c',
  purple: '#8f63d2',
  blue: '#3f8fdd',
}
