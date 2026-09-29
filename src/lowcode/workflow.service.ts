import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BaseDocument } from '../document/base-document';
import { AuthUser } from '../auth/types';

export interface WorkflowTransitionInfo {
  action: string;
  next_state: string;
  allowed_role: string;
}

@Injectable()
export class WorkflowService {
  constructor(private readonly db: DatabaseService) {}

  async getActiveWorkflow(doctype: string): Promise<any | null> {
    const knex = this.db.getKnex();
    const hasTable = await knex.schema.hasTable('tabWorkflow');
    if (!hasTable) return null;

    const workflow = await this.db.table('tabWorkflow')
      .where({ document_type: doctype, is_active: 1 })
      .first();

    if (!workflow) return null;

    // Load states and transitions
    const states = await this.db.table('tabWorkflowState')
      .where({ parent: workflow.name })
      .orderBy('idx', 'asc');

    const transitions = await this.db.table('tabWorkflowTransition')
      .where({ parent: workflow.name })
      .orderBy('idx', 'asc');

    return {
      ...workflow,
      states,
      transitions,
    };
  }

  async getAvailableTransitions(doc: BaseDocument, user: AuthUser): Promise<WorkflowTransitionInfo[]> {
    const workflow = await this.getActiveWorkflow(doc.doctype);
    if (!workflow) return [];

    const stateField = workflow.workflow_state_field || 'workflow_state';
    const currentState = doc.get(stateField) || (workflow.states[0] ? workflow.states[0].state : null);

    const isSuperuser = user.user === 'Administrator' || user.roles.includes('System Manager');

    return workflow.transitions.filter((t: any) => {
      const stateMatch = t.state === currentState;
      const roleMatch = isSuperuser || user.roles.includes(t.allowed_role);
      return stateMatch && roleMatch;
    });
  }

  async applyWorkflow(doc: BaseDocument, action: string, user: AuthUser): Promise<BaseDocument> {
    const workflow = await this.getActiveWorkflow(doc.doctype);
    if (!workflow) {
      throw new NotFoundException(`No active workflow found for DocType "${doc.doctype}"`);
    }

    const stateField = workflow.workflow_state_field || 'workflow_state';
    const currentState = doc.get(stateField) || (workflow.states[0] ? workflow.states[0].state : null);

    const isSuperuser = user.user === 'Administrator' || user.roles.includes('System Manager');

    const transition = workflow.transitions.find((t: any) => {
      const stateMatch = t.state === currentState;
      const actionMatch = t.action.toLowerCase() === action.toLowerCase();
      const roleMatch = isSuperuser || user.roles.includes(t.allowed_role);
      return stateMatch && actionMatch && roleMatch;
    });

    if (!transition) {
      throw new ForbiddenException(
        `Action "${action}" is not permitted from current state "${currentState}" for user "${user.user}"`,
      );
    }

    const nextState = workflow.states.find((s: any) => s.state === transition.next_state);
    if (!nextState) {
      throw new Error(`Target workflow state "${transition.next_state}" does not exist in workflow definition`);
    }

    // Apply state change
    doc.set(stateField, nextState.state);
    const targetDocStatus = nextState.doc_status !== undefined ? Number(nextState.doc_status) : undefined;

    if (targetDocStatus === 1 && doc.docstatus === 0) {
      await doc.submit(user.user);
    } else if (targetDocStatus === 2 && doc.docstatus === 1) {
      await doc.cancel(user.user);
    } else {
      if (targetDocStatus !== undefined) {
        doc.set('docstatus', targetDocStatus);
      }
      await doc.save(user.user);
    }

    return doc;
  }
}
