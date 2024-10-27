# PixivBiu

PixivBiu, Una bonita herramienta **asistente** de Pixiv.

- [中文](/README.md)
- [English](/docs/README_EN.md)
- [日本語](/docs/README_JA.md)
- [Español](/docs/README_ES.md)

## Características

* Búsqueda de Pixiv, permite ordenar por número de favoritos, popularidad y fecha sin membresía.
* Descargue imágenes originales, incluidas ilustraciones, cómics y GIF animados.
* Múltiples modos de descarga, incluidos un solo subproceso, subproceso múltiple y compatibilidad con aria2.
* Acceda a las obras del usuario, colecciones, lista de seguidores, recomendaciones, etc.
* Filtrar imágenes por ancho, alto, tipo, etiquetas, etc.

## Uso

### Código fuente

* Instalar dependencias ejecutando `pip install -r requirements.txt`
  + [Flask](https://github.com/pallets/flask), [requests](https://github.com/psf/requests), [PyYAML](https://github.com/yaml/pyyaml), [Pillow](https://github.com/python-pillow/Pillow), [PixivPy](https://github.com/upbit/pixivpy), [PySocks](https://github.com/Anorov/PySocks)
* Modificar los elementos de configuración relevantes en `./config.yml`, y puedes consultar el [archivo de configuración predeterminado](/app/config/biu_es.yml) para detalles
* Ejecuta `python main.py`
* Acceda a la dirección de ejecución, que es la predeterminada `http://127.0.0.1:4001/`.

### Archivo binario ejecutable

Este proyecto esta escrito en `python@3.10(+)` y esta compilado usando `PyInstaller`.

Se proporcionan versiones compiladas para Windows, macOS y Ubuntu. Si tienes otros requisitos, compílalos tú mismo.

Puedes descargar la versión especifica desde [Github Releases](https://github.com/txperl/PixivBiu/releases) o [Aqui](https://biu.tls.moe/#/lib/dl).

### Docker

- [Docker_Buildx_PixivBiu](https://github.com/zzcabc/Docker_Buildx_PixivBiu) por [zzcabc](https://github.com/zzcabc)

## Contribución

Si deseas participar en el desarrollo de este proyecto, te invitamos a consultar [documento de desarrollo](https://biu.tls.moe/#/develop/quickin).

## Otros

### Gracias para

* [pixivpy](https://github.com/upbit/pixivpy) Soporte de API
* [pixiv.cat](https://pixiv.cat/) Compatibilidad con servidores proxy inversos
* [HTML5 UP](https://html5up.net/) Soporte de código front-end

### Terminos

* Este programa (PixivBiu) es solo para fines de aprendizaje e intercambio. Elimínelo después de lograr su objetivo inicial.
* El autor original no es responsable de ningún evento imprevisto que pueda ocurrir después del uso y no asume ninguna responsabilidad.
* [MIT License](https://choosealicense.com/licenses/mit/)