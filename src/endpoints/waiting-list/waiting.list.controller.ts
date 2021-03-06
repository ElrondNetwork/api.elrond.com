import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WaitingList } from './entities/waiting.list';
import { WaitingListService } from './waiting.list.service';

@Controller()
@ApiTags('waiting-list')
export class WaitingListController {
  constructor(private readonly waitingListService: WaitingListService) { }

  @Get("/waiting-list")
  @ApiOperation({ summary: 'Waiting list', description: 'Returns node waiting list' })
  @ApiOkResponse({ type: [WaitingList] })
  getWaitingList(): Promise<WaitingList[]> {
    return this.waitingListService.getWaitingList();
  }

  @Get("/waiting-list/count")
  @ApiOperation({ summary: 'Waiting list count', description: 'Returns count of node waiting list' })
  @ApiOkResponse({ type: Number })
  getWaitingListCount(): Promise<number> {
    return this.waitingListService.getWaitingListCount();
  }

  @Get("/waiting-list/c")
  @ApiExcludeEndpoint()
  getWaitingListCountAlternative(): Promise<number> {
    return this.waitingListService.getWaitingListCount();
  }
}
