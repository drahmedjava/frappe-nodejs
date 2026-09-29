import { Injectable, BadRequestException } from '@nestjs/common';
import { OnDocEvent } from '../../document/decorators/on-doc-event.decorator';
import { DocumentEventPayload } from '../../document/types';

@Injectable()
export class TaskEventsService {
  @OnDocEvent('Task', 'validate')
  validateDates(payload: DocumentEventPayload) {
    const doc = payload.doc;
    const start = typeof doc.get === 'function' ? doc.get('exp_start_date') : doc.exp_start_date;
    const end = typeof doc.get === 'function' ? doc.get('exp_end_date') : doc.exp_end_date;

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (startDate > endDate) {
        throw new BadRequestException('Expected Start Date cannot be after Expected End Date');
      }
    }

    const progress = typeof doc.get === 'function' ? doc.get('progress') : doc.progress;
    if (progress !== undefined && progress !== null) {
      if (progress < 0 || progress > 100) {
        throw new BadRequestException('Progress must be between 0 and 100');
      }
    }
  }
}
