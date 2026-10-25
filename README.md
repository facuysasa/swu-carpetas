# Carpetas SWU

App personal para ordenar tu colección de Star Wars: Unlimited en tus carpetas, página por página, antes de mover una sola carta en la vida real. Funciona en la compu y en el celular (se instala como app, igual que Semáforo).

## Publicarla (una sola vez, unos 10 minutos)

1. **Creá el repositorio.** En GitHub, *New repository*, nombre `swu-carpetas`, público (GitHub Pages gratis lo pide). Tu colección no se guarda en el repo: queda en tu dispositivo y, si activás la sincronización, en un Gist secreto.
2. **Subí los archivos.** Descomprimí el ZIP. En el repo: *Add file → Upload files* y arrastrá **todo el contenido** de la carpeta, incluida la carpeta `.github`. Confirmá con *Commit changes*.
   - Si después no ves el flujo en la pestaña *Actions*, es que `.github` no se subió (algunos sistemas la ocultan). Creala a mano: *Add file → Create new file*, escribí como nombre `.github/workflows/publicar.yml` y pegá el contenido de ese archivo.
3. **Activá Pages.** *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
4. **Corré la publicación.** *Actions → Publicar la app → Run workflow*. La primera vez tarda varios minutos porque arma el catálogo completo de cartas. Cuando termine, la app queda en:
   `https://facuysasa.github.io/swu-carpetas/`
5. **Instalala en el Pixel.** Abrí esa dirección en Chrome, menú ⋮ → *Instalar app*. Se usa mejor con el celular apaisado.

Cada lunes la acción vuelve a correr sola y renueva el catálogo y los precios. También podés correrla a mano cuando salga una expansión nueva.

## Cargar tu colección

En la mesa, **Importar** y elegí los archivos que exportás de SWUDB. El TXT es mejor que el CSV porque trae nombre, variante, rareza y precio. Podés subir varios a la vez (por ejemplo, uno por color).

- **Actualizar** (recomendado): las cantidades pasan a ser las del archivo. Si más adelante reimportás `verde.txt`, las cartas que ya no estén en ese archivo se quitan.
- **Sumar**: agrega las copias del archivo a las que ya tenés (útil para cargar una compra).
- **Reemplazar todo**: tu colección pasa a ser exactamente la de los archivos.

También podés sumar cartas sueltas desde **Colección → Agregar carta**.

## Usar la compu y el celular con los mismos datos

La app sincroniza a través de un Gist secreto de tu cuenta de GitHub:

1. En GitHub: foto de perfil → *Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)*.
2. Nombre: `Carpetas SWU`. Marcá **solo** el permiso `gist`. Elegí el vencimiento que prefieras.
3. Copiá el token y pegalo en la app: **Ajustes → Sincronizar entre dispositivos → Conectar**. Repetilo en cada dispositivo.

Ese token solo puede leer y escribir tus gists, y queda guardado únicamente en el dispositivo donde lo pegás. Si cambiás cosas en los dos dispositivos sin conexión, la app te pregunta con cuál versión quedarte y guarda la otra como respaldo.

En **Ajustes** también podés descargar una copia de seguridad o restaurarla.

## Cómo se usa

- **La mesa** muestra tus carpetas cerradas. Tocá una para abrirla; la tapa se abre y las hojas se pasan con las flechas de abajo, deslizando con el dedo o con las flechas del teclado.
- **Bolsillo vacío**: abre tu colección con búsqueda y filtros. Las cartas que ya están en otro lugar aparecen oscuras; si elegís una, te pregunta de dónde traerla.
- **Bolsillo ocupado**: mover o intercambiar, reemplazar, sacar, o apilar más copias iguales en el mismo bolsillo. En la compu también podés arrastrar una carta a otro bolsillo (si la soltás sobre una flecha, pasa de página).
- **Ordenar**: llena la carpeta (o un rango de páginas) según filtros y criterios: más caras primero, por color, por expansión, por tipo, variantes especiales o tu propia combinación. Muestra cómo quedaría antes de aplicarlo y lo guarda como versión nueva.
- **Versiones**: cada carpeta puede tener varias formas de ordenarse. La activa es la que se ve en la mesa y la que cuenta para saber qué cartas están ocupadas.
- **Vista general**: toda la carpeta de un vistazo, con cada bolsillo pintado del color de su carta.
- **Foco**: muestra una sola página, más grande. Con el celular vertical se activa solo.
- **Deshacer y rehacer**: botones arriba, o Ctrl+Z / Ctrl+Shift+Z.

## La mesa

La mesa es un espacio continuo donde conviven tus carpetas y las cartas que vas sacando:

- **Moverte:** arrastrá sobre la madera para desplazarte y usá la rueda del mouse para acercar o alejar (en el celular, deslizá con un dedo y pellizcá). El botón con el recuadro vuelve a centrar en tus carpetas o en la carpeta abierta.
- **Sin guardar:** el botón de cartas abre todo lo que todavía no está en una carpeta, una caja ni en la mesa. Arrastrá una carta a la mesa, a una página o a una caja; o tocá varias y elegí *A la mesa*, *A la página* o *A una caja*.
- **Cartas en la mesa:** arrastralas para agruparlas. Hacé clic para elegir una, Shift + clic para sumar, y Shift + arrastrar sobre la madera (o el botón de selección) para elegir varias con un recuadro. Con varias elegidas podés apilarlas, separar una pila, ordenarlas en filas, mandarlas a una caja o quitarlas de la mesa (también con la tecla Suprimir; vuelven a *sin guardar*).
- **De la mesa a la carpeta:** soltá la selección sobre una página y se acomoda en sus bolsillos vacíos, empezando por el bolsillo donde la soltaste. Una sola carta sobre un bolsillo ocupado las intercambia. En la mesa principal, soltarlas sobre una carpeta cerrada las guarda en sus primeros bolsillos libres.
- **De la carpeta a la mesa:** arrastrá la carta de un bolsillo afuera de la carpeta, o usá *Dejar en la mesa* en el menú del bolsillo.
- En el celular, mantené apretada una carta medio segundo para arrastrarla.

Las cartas que están en la mesa o en una caja cuentan como guardadas: no aparecen como libres y, si las pedís desde un bolsillo, el selector te ofrece traerlas de donde estén.

## Cajas

Además de carpetas podés crear cajas de mazo (en la mesa, *Nueva caja*): nombre, capacidad (60, 80, 100, 120 o la que quieras), color y, si querés, una foto del frente de tu caja. Las cajas guardan cartas sin bolsillos, como en la vida real.

- **Guardar en una caja:** soltá sobre la caja cartas de la mesa o de *Sin guardar*; o usá *A una caja* en la barra de selección, en *Sin guardar* o en el menú de un bolsillo (*Guardar en una caja*). También podés abrir la caja y tocar *Agregar cartas*.
- **Ver lo que tiene:** tocá la caja. Ves sus cartas con filtros, cuántas lleva sobre su capacidad (en rojo si se pasa) y podés sacar copias o llevarlas a la mesa.
- Las cajas se mueven por la mesa arrastrándolas, igual que las carpetas.

## Dónde está cada carta

En *Colección*, debajo de cada carta se ve dónde está: carpeta, página y bolsillo; la mesa; una caja; o *sin guardar*. Si tenés copias en varios lugares, se indica cuántos más hay. En la ficha de la carta aparece cada copia con su lugar exacto y un botón para ir: abre la carpeta en esa página y hace titilar el bolsillo, encuadra la carta en la mesa o abre la caja. En *Filtros → Dónde está* podés ver solo las cartas sin guardar, las de una carpeta o caja en particular, las de la mesa, etc.

## Filtros

En la colección, en el selector de cartas y en *Ordenar* tocá **Filtros**. Se combinan: dentro de un grupo vale cualquiera de los elegidos y entre grupos se cumplen todos. Por ejemplo, *Prestige* + el círculo azul muestra solo las Prestige de Vigilancia. Lo aplicado queda a la vista como etiquetas que podés quitar de a una.

## Personajes

En la mesa, **Personajes**. Los personajes salen solos del nombre de tus cartas (la unidad "Obi-Wan Kenobi" es Obi-Wan). Para las que no lo nombran, como eventos o mejoras, la IA mira la ilustración y sugiere quién aparece:

1. Creá una API key gratuita en [Google AI Studio](https://aistudio.google.com/apikey) (sin tarjeta) y pegala en *Ajustes → Detección de personajes*. Queda guardada solo en ese dispositivo.
2. En *Personajes*, tocá **Detectar con IA**. Revisa tus ilustraciones de a tandas y guarda lo avanzado; si se alcanza el límite gratuito, espera y sigue, o la frenás y continuás otro día. Cuando importás cartas nuevas, las revisa sola.
3. Revisá las sugerencias con ✓ o ✕, o agregá personajes a mano desde la ficha de cada carta.

Lo que confirmás o descartás se usa como ejemplo en los pedidos siguientes, así que acierta cada vez más. Desde la ficha de un personaje podés pedir **Buscar a [personaje] con IA en el resto** para encontrar cartas donde aparece y todavía no está etiquetado. Después podés filtrar por personaje u ordenar una carpeta separando por personaje.

## Sin conexión y en varios dispositivos

- **Todo queda guardado en el dispositivo** al instante: colección, carpetas y sus versiones, cartas en la mesa y su lugar, personajes y etiquetas, y ajustes. Lo único que es propio de cada dispositivo es el zoom y la página donde quedaste, y las claves (token de GitHub y API key de Gemini).
- **Sin internet la app funciona igual** una vez instalada: abre, muestra tus cartas y guarda todo lo que hagas.
- **Imágenes sin conexión:** cuando importás, la app guarda en el dispositivo la imagen de cada carta (verás el avance arriba). Si el sitio de imágenes lo permite, guarda una versión más liviana. En *Ajustes → Usar sin conexión* ves cuántas hay y cuánto espacio ocupan. La primera vez hace falta conexión para bajarlas.
- **Compu y celular sincronizados:** con el token de GitHub conectado en los dos, cada cambio se sube a los pocos segundos y la app trae lo del otro dispositivo cada 30 segundos y al volver a abrirla.
- **Cambios en los dos sin conexión:** al reconectarse se unen solos, bolsillo por bolsillo y carta por carta. Solo si el mismo bolsillo cambió distinto en los dos queda lo del último que sincroniza (en ese caso se pierde el historial de deshacer de ese momento).
- Conviene instalar la app (*Instalar app* en Chrome): así el navegador no borra sus datos para liberar espacio.

## Probar sin publicar

`carpetas-swu-local.html` es la app completa en un solo archivo, con el catálogo incluido: abrilo con doble clic en Chrome. Las imágenes salen de SWUDB (en inglés) y lo que guardes queda solo en ese navegador: sin sincronización ni imágenes sin conexión, que funcionan en la versión publicada.

## Si algo no se ve bien

- **Faltan imágenes o datos**: entrá a *Actions* y mirá el último *Publicar la app*. El paso *Armar el catálogo de cartas* dice cuántas cartas trajo y cuántas tienen imagen en español. Si una fuente falló, se conserva el catálogo anterior; volvé a correr la acción más tarde.
- **Imágenes en inglés**: la imagen en español sale de la base oficial; si para alguna carta no está (pasa con promos), se usa la inglesa. Podés elegir el idioma en *Ajustes*.
- **No ves un cambio nuevo de la app**: cerrala del todo y volvé a abrirla (la app guarda una copia para funcionar sin conexión).

## Créditos

Datos y precios de cartas: [swu-db.com](https://www.swu-db.com), [swu-card-db](https://github.com/nmpeterson/swu-card-db) (MIT), imágenes de [SWUDB](https://swudb.com) y la base oficial de Star Wars: Unlimited. Proyecto personal, sin fines comerciales y sin relación con Fantasy Flight Games, Asmodee ni Lucasfilm. Interfaz hecha con Preact y htm (MIT) y la tipografía Barlow (OFL).
