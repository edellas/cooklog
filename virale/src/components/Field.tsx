import { forwardRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { color, font, radius, space } from '../design/tokens';

/**
 * Campo di testo con stato di focus disegnato: il bordo diventa giallo (visibile anche da tastiera),
 * al posto del contorno di default del browser. Cursore e selezione nel colore del sistema.
 * Con `invalid` il bordo è rosso (l'errore va scritto sotto il campo).
 */
export const Field = forwardRef<TextInput, TextInputProps & { prefix?: ReactNode; containerStyle?: StyleProp<ViewStyle>; invalid?: boolean }>(function Field(
  { prefix, containerStyle, style, invalid, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.box, focused && styles.focused, invalid && styles.invalid, containerStyle]}>
      {prefix}
      <TextInput
        ref={ref}
        placeholderTextColor={color.paperFaint}
        selectionColor={color.giallo}
        cursorColor={color.giallo}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object), style]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.raised,
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: color.line,
    paddingHorizontal: space[4],
  },
  focused: { borderColor: color.giallo },
  invalid: { borderColor: color.matita },
  input: { flex: 1, minWidth: 0, color: color.paper, fontFamily: font.ui, fontSize: 16, paddingVertical: 13 },
});
