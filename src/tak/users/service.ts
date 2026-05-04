import type { LoadedConfig } from "../../core/config-store.js";
import type { ResolvedProfile } from "../../core/profile-resolution.js";
import { parseTakError, requestTak, requestTakJson } from "../http.js";

interface UsernameModel {
  username: string;
}

interface GroupNameModel {
  groupname: string;
}

export interface TakUserGroupMembership {
  groupList: string[];
  groupListIN: string[];
  groupListOUT: string[];
  username: string;
}

export interface TakGroupMembers {
  groupname: string;
  usersInGroupList: string[];
  usersInGroupListIN: string[];
  usersInGroupListOUT: string[];
}

export interface TakUsersContext {
  config: LoadedConfig;
  profile: ResolvedProfile;
  timeoutMs: number;
}

interface UserMutationInput {
  groupList?: string[];
  groupListIN?: string[];
  groupListOUT?: string[];
  password: string;
  username: string;
}

interface GroupMutationInput {
  groupList?: string[];
  groupListIN?: string[];
  groupListOUT?: string[];
  username: string;
}

function uniqueSorted(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeMembership(payload: Partial<TakUserGroupMembership> & { username: string }): TakUserGroupMembership {
  return {
    groupList: uniqueSorted(payload.groupList),
    groupListIN: uniqueSorted(payload.groupListIN),
    groupListOUT: uniqueSorted(payload.groupListOUT),
    username: payload.username
  };
}

function normalizeGroupMembers(payload: Partial<TakGroupMembers> & { groupname: string }): TakGroupMembers {
  return {
    groupname: payload.groupname,
    usersInGroupList: uniqueSorted(payload.usersInGroupList),
    usersInGroupListIN: uniqueSorted(payload.usersInGroupListIN),
    usersInGroupListOUT: uniqueSorted(payload.usersInGroupListOUT)
  };
}

function summarizeContext(context: TakUsersContext) {
  return {
    configPath: context.config.path,
    profile: context.profile
  };
}

function userManagementPath(pathname: string): string {
  return `/user-management/api${pathname}`;
}

function assertSuccessfulResponse(response: Awaited<ReturnType<typeof requestTak>>): void {
  if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
    throw new Error(parseTakError(response));
  }
}

export async function listTakUsers(context: TakUsersContext) {
  const users = await requestTakJson<UsernameModel[]>(context.profile, context.timeoutMs, {
    pathname: userManagementPath("/list-users"),
    portName: "enrollment"
  });

  return {
    command: "users list",
    ...summarizeContext(context),
    users: users
      .map((entry) => ({ username: entry.username }))
      .sort((left, right) => left.username.localeCompare(right.username))
  };
}

export async function listTakGroupNames(context: TakUsersContext) {
  const groups = await requestTakJson<GroupNameModel[]>(context.profile, context.timeoutMs, {
    pathname: userManagementPath("/list-groupnames"),
    portName: "enrollment"
  });

  return {
    command: "users groups list",
    ...summarizeContext(context),
    groups: groups
      .map((entry) => ({ groupname: entry.groupname }))
      .sort((left, right) => left.groupname.localeCompare(right.groupname))
  };
}

export async function getTakUserGroups(context: TakUsersContext, username: string) {
  const membership = await requestTakJson<TakUserGroupMembership>(context.profile, context.timeoutMs, {
    pathname: userManagementPath(`/get-groups-for-user/${encodeURIComponent(username)}`),
    portName: "enrollment"
  });

  return {
    command: "users groups show",
    ...summarizeContext(context),
    user: normalizeMembership(membership)
  };
}

export async function getTakGroupMembers(context: TakUsersContext, groupname: string) {
  const members = await requestTakJson<TakGroupMembers>(context.profile, context.timeoutMs, {
    pathname: userManagementPath(`/users-in-group/${encodeURIComponent(groupname)}`),
    portName: "enrollment"
  });

  return {
    command: "users groups members",
    ...summarizeContext(context),
    group: normalizeGroupMembers(members)
  };
}

export async function createTakUser(context: TakUsersContext, input: UserMutationInput) {
  const payload = normalizeMembership(input);

  const response = await requestTak(context.profile, context.timeoutMs, {
    body: JSON.stringify({
      ...payload,
      password: input.password
    }),
    method: "POST",
    pathname: userManagementPath("/new-user"),
    portName: "enrollment"
  });
  assertSuccessfulResponse(response);

  return {
    command: "users create",
    ...summarizeContext(context),
    user: (await getTakUserGroups(context, input.username)).user
  };
}

export async function resetTakUserPassword(context: TakUsersContext, username: string, password: string) {
  const response = await requestTak(context.profile, context.timeoutMs, {
    body: JSON.stringify({
      password,
      username
    }),
    method: "PUT",
    pathname: userManagementPath("/change-user-password"),
    portName: "enrollment"
  });

  assertSuccessfulResponse(response);

  return {
    command: "users reset-password",
    ...summarizeContext(context),
    username
  };
}

export async function deleteTakUser(context: TakUsersContext, username: string) {
  const response = await requestTak(context.profile, context.timeoutMs, {
    method: "DELETE",
    pathname: userManagementPath(`/delete-user/${encodeURIComponent(username)}`),
    portName: "enrollment"
  });

  assertSuccessfulResponse(response);

  return {
    command: "users delete",
    ...summarizeContext(context),
    deleted: username
  };
}

export async function setTakUserGroups(context: TakUsersContext, input: GroupMutationInput) {
  const payload = normalizeMembership(input);
  const response = await requestTak(context.profile, context.timeoutMs, {
    body: JSON.stringify(payload),
    method: "PUT",
    pathname: userManagementPath("/update-groups"),
    portName: "enrollment"
  });

  assertSuccessfulResponse(response);

  return {
    command: "users groups set",
    ...summarizeContext(context),
    user: (await getTakUserGroups(context, input.username)).user
  };
}

export async function addTakUserGroups(context: TakUsersContext, input: GroupMutationInput) {
  const current = (await getTakUserGroups(context, input.username)).user;
  return await setTakUserGroups(context, {
    groupList: [...current.groupList, ...(input.groupList ?? [])],
    groupListIN: [...current.groupListIN, ...(input.groupListIN ?? [])],
    groupListOUT: [...current.groupListOUT, ...(input.groupListOUT ?? [])],
    username: input.username
  });
}

export async function removeTakUserGroups(context: TakUsersContext, input: GroupMutationInput) {
  const current = (await getTakUserGroups(context, input.username)).user;
  const removeSet = {
    both: new Set(uniqueSorted(input.groupList)),
    inOnly: new Set(uniqueSorted(input.groupListIN)),
    outOnly: new Set(uniqueSorted(input.groupListOUT))
  };

  return await setTakUserGroups(context, {
    groupList: current.groupList.filter((group) => !removeSet.both.has(group)),
    groupListIN: current.groupListIN.filter((group) => !removeSet.inOnly.has(group)),
    groupListOUT: current.groupListOUT.filter((group) => !removeSet.outOnly.has(group)),
    username: input.username
  });
}
