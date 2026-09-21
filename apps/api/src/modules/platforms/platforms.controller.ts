import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { platformsCatalog } from './platforms.catalog';

@ApiTags('platforms')
@Controller('platforms')
export class PlatformsController {
  /**
   * Catálogo de redes y formatos.
   *
   * Existe para que la UI (pestaña Social del dashboard) arme sus selectores
   * **desde acá** y no con listas propias: agregar o quitar una red es tocar el
   * catálogo del backend, y el front lo toma solo. Sin esto, cada red nueva
   * obligaría a un cambio en dos repos.
   *
   * No expone nada sensible: son definiciones, no datos de nadie.
   */
  @Get()
  @ApiOperation({ summary: 'Redes y formatos soportados (la UI se arma desde acá)' })
  list(): ReturnType<typeof platformsCatalogResponse> {
    return platformsCatalogResponse();
  }
}

function platformsCatalogResponse(): { platforms: ReturnType<typeof platformsCatalog> } {
  return { platforms: platformsCatalog() };
}
