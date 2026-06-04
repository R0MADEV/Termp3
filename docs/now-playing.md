# Ver y controlar catunes desde cualquier pestaña

No necesitas tmux, zellij ni ventanas flotantes. catunes te deja **ver** lo que
suena y **controlarlo** desde cualquier panel/pestaña, en **cualquier terminal**
y sistema operativo.

## Ver qué suena (automático, universal)

Mientras catunes reproduce, actualiza el **título del terminal** con el tema
actual. Se ve sin configurar nada:

- **Warp** → en la barra de pestañas.
- **iTerm / kitty / Windows Terminal / etc.** → en el título de la pestaña/ventana.

Y si quieres el texto para una barra propia:

```bash
catunes status     # ▶ Artista - Tema 1:24/3:58   (vacío si no hay nada sonando)
```

## Controlar desde cualquier pestaña

Con un reproductor en marcha, desde **cualquier otro panel**:

```bash
catunes pause      # pausa / reanuda
catunes next       # siguiente
catunes prev       # anterior
catunes vol +5     # volumen (+5 / -5)
```

Funciona porque el reproductor abre un pequeño socket de control local
(`~/.config/catunes/control.sock`) y estos comandos le mandan la orden.

### Atajos cómodos

En tu `~/.zshrc` o `~/.bashrc`:

```bash
alias pp='catunes pause'
alias nn='catunes next'
alias bb='catunes prev'
```

Así, en cualquier panel: `nn` salta de canción al instante.
