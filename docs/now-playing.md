# Ver y controlar termp3 desde cualquier pestaña

No necesitas tmux, zellij ni ventanas flotantes. termp3 te deja **ver** lo que
suena y **controlarlo** desde cualquier panel/pestaña, en **cualquier terminal**
y sistema operativo.

## Ver qué suena (automático, universal)

Mientras termp3 reproduce, actualiza el **título del terminal** con el tema
actual. Se ve sin configurar nada:

- **Warp** → en la barra de pestañas.
- **iTerm / kitty / Windows Terminal / etc.** → en el título de la pestaña/ventana.

Y si quieres el texto para una barra propia:

```bash
termp3 status     # ▶ Artista - Tema 1:24/3:58   (vacío si no hay nada sonando)
```

## Controlar desde cualquier pestaña

Con un reproductor en marcha, desde **cualquier otro panel**:

```bash
termp3 pause      # pausa / reanuda
termp3 next       # siguiente
termp3 prev       # anterior
termp3 vol +5     # volumen (+5 / -5)
```

Funciona porque el reproductor abre un pequeño socket de control local
(`~/.config/termp3/control.sock`) y estos comandos le mandan la orden.

### Atajos cómodos

En tu `~/.zshrc` o `~/.bashrc`:

```bash
alias pp='termp3 pause'
alias nn='termp3 next'
alias bb='termp3 prev'
```

Así, en cualquier panel: `nn` salta de canción al instante.
