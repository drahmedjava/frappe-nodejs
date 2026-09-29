export interface AuthUser {
  user: string;
  roles: string[];
  isGuest: boolean;
}

export type PermissionAction = 'read' | 'write' | 'create' | 'delete' | 'submit' | 'cancel';
